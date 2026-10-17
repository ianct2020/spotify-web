// tests/letras.test.mjs — la letra de lrclib en la ficha de canción (v=311, tanda 59)
//
// POR QUÉ ESTA SUITE EXISTE: la ficha de canción gana un botón «Letra» que le
// pide a lrclib.net la letra de UN tema, al tocarlo, y la guarda. Todo lo que se
// puede decidir sin red vive en `util/letras.js` (puro: sin red, sin reloj, sin
// IndexedDB, sin DOM) y se vigila acá:
//   1. la URL: `artist_name` y `track_name` y NADA más (ni `album_name` ni
//      `duration`: mandar la duración haría que una diferencia de más de 2 s
//      diera 404 donde hoy hay letra), bien codificados;
//   2. las cuatro clases de respuesta (`letra` / `instrumental` / `no-hay` /
//      `fallo`) y qué se guarda de cada una (un 503 o un corte, NADA);
//   3. `plainLyrics` antes que `syncedLyrics`, y las marcas de tiempo fuera;
//   4. la verificación de nombres, con las funciones IMPORTADAS de
//      `track-match.js` (otro artista u otro título → «no hay»);
//   5. el aviso de duración: 2 s justos, sin aviso; 2,5 s, con aviso, en `m:ss`;
//   6. el registro recortado: solo los campos que se leen al pintar;
//   7. el reintento del 503 (lo que diga `retry-after`, 1 s si no se lee).
//
// 🔴 Las letras, los artistas y los temas de acá son INVENTADOS: el repo es
// público y una letra de verdad es texto con derechos de autor.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = join(raiz, 'src/js/util/letras.js');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

let m;
try {
  m = await import(pathToFileURL(RUTA).href);
} catch (e) {
  console.log(`  ✗ no se pudo importar src/js/util/letras.js: ${e.code || e.message}`);
  console.log(`\n0 asserts OK · 1 fallaron`);
  process.exit(1);
}
const {
  URL_LRCLIB, PREFIJO_LETRAS, claveLetra, urlLetra, sinMarcasDeTiempo, textoDeRespuesta,
  nombresCoinciden, registroDe, registroNoHay, clasificarRespuesta, decidir,
  avisoDuracion, fmtMinSeg, esperaReintentoMs, TEXTOS,
} = m;

const FECHA = '2026-10-16T21:00:00.000Z';
const PEDIDO = { name: 'Canción del Faro', artists: ['Banda Inventada', 'Otra Invitada'] };
// Una letra INVENTADA (cuatro renglones y un hueco), en sus dos formas.
const PLANA = 'Primera línea inventada\nSegunda línea inventada\n\nTercera línea, después del hueco';
const SINCRO = '[00:01.20] Primera línea inventada\n[00:04.75] Segunda línea inventada\n[00:08.00]\n[00:09.10] Tercera línea, después del hueco';
const respuesta = (extra = {}) => ({
  id: 4242, name: 'Canción del Faro', trackName: 'Canción del Faro', artistName: 'Banda Inventada',
  albumName: 'Disco Inventado', duration: 200, instrumental: false, hasWordSync: false,
  plainLyrics: PLANA, syncedLyrics: SINCRO, lyricsfile: null, ...extra,
});

// ── 1. La URL ───────────────────────────────────────────────────────────────
console.log('1. urlLetra');
ok(URL_LRCLIB === 'https://lrclib.net/api/get', 'el endpoint es /api/get de lrclib.net');
const u = new URL(urlLetra('Banda Inventada', 'Canción del Faro'));
ok(u.origin + u.pathname === URL_LRCLIB, `la URL apunta a ${URL_LRCLIB}`);
ok([...u.searchParams.keys()].join(',') === 'artist_name,track_name', `solo artist_name y track_name, en ese orden (${[...u.searchParams.keys()].join(',')})`);
ok(u.searchParams.get('artist_name') === 'Banda Inventada' && u.searchParams.get('track_name') === 'Canción del Faro', 'los valores vuelven tal cual (con la tilde)');
const raro = urlLetra('A & B / "C"', 'Tema & Otro / «Sí» "no"');
const ur = new URL(raro);
ok(ur.searchParams.get('artist_name') === 'A & B / "C"', `el & y la / del artista no rompen la URL (${raro})`);
ok(ur.searchParams.get('track_name') === 'Tema & Otro / «Sí» "no"', 'ni las comillas del título');
ok(!/[&]{2}|&B|&Otro/.test(raro.split('?')[1]) && (raro.split('?')[1].match(/&/g) || []).length === 1, 'un solo & separa los dos parámetros');
const yen = new URL(urlLetra('¥$', 'Tema Inventado'));
ok(yen.searchParams.get('artist_name') === '¥$' && /%C2%A5%24/.test(urlLetra('¥$', 'x')), '«¥$» va codificado (%C2%A5%24) y vuelve igual');
ok(!/album_name|duration/.test(urlLetra('A', 'B')), 'ni album_name ni duration');

// ── 2. La clave ─────────────────────────────────────────────────────────────
console.log('2. clave');
ok(PREFIJO_LETRAS === 'letras_v1_' && claveLetra('1aAaAaAaAaAaAaAaAaAaAa') === 'letras_v1_1aAaAaAaAaAaAaAaAaAaAa', 'letras_v1_<trackId>, sin uid');

// ── 3. Las marcas de tiempo ─────────────────────────────────────────────────
console.log('3. sinMarcasDeTiempo');
ok(sinMarcasDeTiempo(SINCRO) === PLANA, 'la sincronizada sin marcas da la plana (el renglón con solo la marca queda vacío)');
ok(sinMarcasDeTiempo('[01:02] Sin centésimas inventado\n[1:02.345] Con milésimas inventado') === 'Sin centésimas inventado\nCon milésimas inventado', '[mm:ss] y [m:ss.xxx] también salen');
ok(sinMarcasDeTiempo('[00:01.00][00:30.00] Estribillo inventado') === 'Estribillo inventado', 'dos marcas pegadas al principio salen las dos');
ok(sinMarcasDeTiempo('[00:01.00] Un [corchete] en medio') === 'Un [corchete] en medio', 'un corchete en medio del renglón no se toca');
ok(sinMarcasDeTiempo('[00:00.00]\n[00:01.00] Uno inventado\n[00:02.00]') === 'Uno inventado', 'los renglones vacíos del principio y del final se van');
ok(sinMarcasDeTiempo('[00:01.00] Uno\r\n[00:02.00] Dos') === 'Uno\nDos', 'los \\r\\n se leen como salto');

// ── 4. Qué texto se muestra ─────────────────────────────────────────────────
console.log('4. textoDeRespuesta');
ok(textoDeRespuesta(respuesta({ plainLyrics: 'Plana inventada', syncedLyrics: '[00:01.00] Sincro inventada' })) === 'Plana inventada', 'plainLyrics antes que syncedLyrics');
ok(textoDeRespuesta(respuesta({ plainLyrics: null })) === PLANA, 'sin plainLyrics, la sincronizada sin marcas');
ok(textoDeRespuesta(respuesta({ plainLyrics: '   ', syncedLyrics: SINCRO })) === PLANA, 'una plainLyrics en blanco cuenta como ausente');
ok(textoDeRespuesta(respuesta({ plainLyrics: null, syncedLyrics: null })) === '', 'sin ninguna, cadena vacía');

// ── 5. La verificación de nombres ───────────────────────────────────────────
console.log('5. nombresCoinciden');
const tm = readFileSync(RUTA, 'utf8');
ok(/import\s*\{[^}]*\btitleMatches\b[^}]*\bartistMatches\b[^}]*\}\s*from\s*'\.\/track-match\.js'/.test(tm) || /import\s*\{[^}]*\bartistMatches\b[^}]*\btitleMatches\b[^}]*\}\s*from\s*'\.\/track-match\.js'/.test(tm),
  'titleMatches y artistMatches se IMPORTAN de track-match.js (no se copian: v=219)');
ok(!/function\s+(titleMatches|artistMatches|normText|similarity)\b/.test(tm), 'letras.js no define su propia regla de nombres');
ok(nombresCoinciden(PEDIDO, respuesta()) === true, 'el mismo tema y el mismo artista pasan');
ok(nombresCoinciden(PEDIDO, respuesta({ artistName: 'banda inventada' })) === true, 'las mayúsculas no importan');
ok(nombresCoinciden(PEDIDO, respuesta({ artistName: 'Otra Invitada' })) === true, 'vale cualquiera de los artistas pedidos');
ok(nombresCoinciden(PEDIDO, respuesta({ artistName: 'Grupo Ajeno' })) === false, 'otro artista NO pasa');
ok(nombresCoinciden(PEDIDO, respuesta({ trackName: 'Otra Canción Distinta' })) === false, 'otro título NO pasa');
ok(nombresCoinciden(PEDIDO, respuesta({ trackName: null })) === false, 'sin título NO pasa');
ok(nombresCoinciden({ name: '夜の灯台', artists: ['Banda Inventada'] }, respuesta({ trackName: '夜の灯台' })) === true,
  'un título que normText deja vacío pasa si vuelve IDÉNTICO (lrclib compara por igualdad)');
ok(nombresCoinciden({ name: '夜の灯台', artists: ['Banda Inventada'] }, respuesta({ trackName: '朝の灯台' })) === false,
  '...y no pasa si vuelve otro');

// ── 6. Las cuatro clases y qué se guarda ────────────────────────────────────
console.log('6. clasificarRespuesta');
const c200 = clasificarRespuesta({ status: 200, cuerpo: respuesta() }, PEDIDO, FECHA);
ok(c200.clase === 'letra' && c200.registro && c200.reintentable === false, `200 con letra → letra, con registro (${c200.clase})`);
const cInst = clasificarRespuesta({ status: 200, cuerpo: respuesta({ instrumental: true, plainLyrics: null, syncedLyrics: null }) }, PEDIDO, FECHA);
ok(cInst.clase === 'instrumental' && cInst.registro?.instrumental === true, `instrumental → instrumental, guardado (${cInst.clase})`);
const c404 = clasificarRespuesta({ status: 404, cuerpo: { code: 404, name: 'TrackNotFound', message: 'Failed to find specified track' } }, PEDIDO, FECHA);
ok(c404.clase === 'no-hay' && c404.registro?.noHay === true && c404.registro?.fecha === FECHA, `404 → no-hay, guardado con la fecha (${JSON.stringify(c404.registro)})`);
const cOtro = clasificarRespuesta({ status: 200, cuerpo: respuesta({ artistName: 'Grupo Ajeno' }) }, PEDIDO, FECHA);
ok(cOtro.clase === 'no-hay', `200 de OTRO artista → no-hay (${cOtro.clase})`);
ok(cOtro.registro && cOtro.registro.artistName === 'Grupo Ajeno', '...y se guarda lo que contestó lrclib (la decisión se recalcula al pintar)');
const cVacio = clasificarRespuesta({ status: 200, cuerpo: respuesta({ plainLyrics: null, syncedLyrics: null }) }, PEDIDO, FECHA);
ok(cVacio.clase === 'no-hay', `200 sin letra ni instrumental → no-hay (${cVacio.clase})`);
const c503 = clasificarRespuesta({ status: 503, cuerpo: { message: 'overloaded' } }, PEDIDO, FECHA);
ok(c503.clase === 'fallo' && c503.registro === null && c503.reintentable === true, '503 → fallo, NADA guardado, reintentable');
for (const [status, cuerpo, que] of [[429, {}, '429'], [500, {}, '500'], [502, undefined, '502'], [0, undefined, 'corte de red'], [200, undefined, '200 que no es JSON'], [200, 'texto', '200 con un cuerpo que no es objeto'], [400, {}, '400']]) {
  const c = clasificarRespuesta({ status, cuerpo }, PEDIDO, FECHA);
  ok(c.clase === 'fallo' && c.registro === null && c.reintentable === false, `${que} → fallo, nada guardado, sin reintento automático (${c.clase}/${c.reintentable})`);
}

// ── 7. El registro recortado ────────────────────────────────────────────────
console.log('7. registroDe');
const reg = registroDe(respuesta(), FECHA);
const campos = Object.keys(reg).sort().join(',');
ok(campos === 'artistName,duration,fecha,id,instrumental,texto,trackName', `solo los campos que se leen al pintar (${campos})`);
ok(reg.texto === PLANA && reg.id === 4242 && reg.duration === 200 && reg.instrumental === false && reg.fecha === FECHA, 'con sus valores');
ok(!('syncedLyrics' in reg) && !('plainLyrics' in reg) && !('albumName' in reg) && !('lyricsfile' in reg), 'ni las dos letras crudas, ni el álbum, ni lyricsfile');
const regSinc = registroDe(respuesta({ plainLyrics: null }), FECHA);
ok(regSinc.texto === PLANA, 'de una sincronizada se guarda el texto ya sin marcas');
ok(JSON.stringify(registroNoHay(FECHA)) === JSON.stringify({ noHay: true, fecha: FECHA }), 'el 404 se guarda como { noHay: true, fecha }');

// ── 8. Decidir al pintar ────────────────────────────────────────────────────
console.log('8. decidir');
const d1 = decidir(reg, PEDIDO, null);
ok(d1.clase === 'letra' && d1.texto === PLANA && d1.aviso === null, 'letra, sin aviso si no hay duración propia');
ok(decidir(registroNoHay(FECHA), PEDIDO, 200000).clase === 'no-hay', 'un noHay guardado → no-hay');
ok(decidir(registroDe(respuesta({ artistName: 'Grupo Ajeno' }), FECHA), PEDIDO, null).clase === 'no-hay', 'un registro de otro artista → no-hay (también al releer la caché)');
ok(decidir(registroDe(respuesta({ instrumental: true }), FECHA), PEDIDO, null).clase === 'instrumental', 'instrumental gana aunque venga texto');
ok(decidir(null, PEDIDO, null) === null, 'sin registro, null (hay que pedirla)');

// ── 9. El aviso de duración ─────────────────────────────────────────────────
console.log('9. avisoDuracion');
ok(fmtMinSeg(221) === '3:41' && fmtMinSeg(238) === '3:58' && fmtMinSeg(65) === '1:05' && fmtMinSeg(59.6) === '1:00', 'm:ss (221 → 3:41, 65 → 1:05, 59,6 → 1:00)');
ok(avisoDuracion(221, 238000) === 'Puede ser de otra versión: esta dura 3:41 y la tuya 3:58.', `el texto del encargo (${avisoDuracion(221, 238000)})`);
ok(avisoDuracion(200, 202000) === null, '2 s justos: sin aviso (el margen del servidor es ±2 s)');
ok(avisoDuracion(200, 198000) === null, '2 s justos hacia el otro lado: sin aviso');
ok(typeof avisoDuracion(200, 202500) === 'string', '2,5 s: con aviso');
ok(typeof avisoDuracion(202.5, 200000) === 'string', '2,5 s hacia el otro lado: con aviso');
ok(avisoDuracion(200, null) === null && avisoDuracion(null, 200000) === null && avisoDuracion(200, 0) === null, 'sin duración de un lado, sin aviso');
ok(decidir(reg, PEDIDO, 203000).aviso === 'Puede ser de otra versión: esta dura 3:20 y la tuya 3:23.', 'decidir lleva el aviso con 3 s de diferencia');
ok(decidir(reg, PEDIDO, 201000).aviso === null, '...y no con 1 s');

// ── 10. El reintento del 503 ────────────────────────────────────────────────
console.log('10. esperaReintentoMs');
ok(esperaReintentoMs('1') === 1000, 'retry-after: 1 → 1 s');
ok(esperaReintentoMs('3') === 3000, 'retry-after: 3 → 3 s');
ok(esperaReintentoMs(null) === 1000 && esperaReintentoMs('') === 1000 && esperaReintentoMs('mañana') === 1000, 'sin cabecera o ilegible → 1 s');
ok(esperaReintentoMs('600') === 10000, 'un retry-after enorme se corta en 10 s (la ficha no se queda colgada)');

// ── 11. El copy (castellano de España) y la hoja ────────────────────────────
console.log('11. textos');
ok(TEXTOS.noHay === 'lrclib no tiene la letra de este tema.', 'el 404');
ok(TEXTOS.noContesta === 'lrclib no contesta ahora. Prueba otra vez en un rato.', 'el fallo (forma de «tú»)');
ok(TEXTOS.instrumental === 'Es instrumental.' && TEXTOS.fuente === 'Letra de lrclib.net', 'instrumental y la fuente');
ok(TEXTOS.buscarDeNuevo === 'Buscar de nuevo' && TEXTOS.reintentar === 'Reintentar', 'los dos botones');
ok(!/\bsólo\b|tenés|podés|probá/.test(Object.values(TEXTOS).join(' ')), 'sin voseo y sin «sólo»');

// ── 12. «Limpiar caché» se las lleva; el cambio de usuario, no ──────────────
console.log('12. limpiar caché');
const { CONSERVAR_CLAVES, CONSERVAR_PREFIJOS, LO_QUE_SE_CONSERVA } = await import(pathToFileURL(join(raiz, 'src/js/util/limpiar-cache.js')).href);
const { clavesABorrar } = await import(pathToFileURL(join(raiz, 'src/js/idb.js')).href);
ok(!CONSERVAR_PREFIJOS.some(p => claveLetra('x').startsWith(p)) && !CONSERVAR_CLAVES.includes(claveLetra('x')), 'letras_v1_ NO está en lo que se conserva (es re-pedible, una por tema)');
ok(clavesABorrar([claveLetra('1aAaAaAaAaAaAaAaAaAaAa'), 'all_liked_tracks'], CONSERVAR_CLAVES, CONSERVAR_PREFIJOS).join() === claveLetra('1aAaAaAaAaAaAaAaAaAaAa'), '«Limpiar caché» borra una letra guardada y conserva los me gusta');
ok(!/letra/i.test(LO_QUE_SE_CONSERVA), 'LO_QUE_SE_CONSERVA no promete conservar las letras');
const apiFuente = readFileSync(join(raiz, 'src/js/api.js'), 'utf8');
ok(!/letras_v1_|PREFIJO_LETRAS/.test(apiFuente), 'el cambio de usuario (api.js) no toca las letras: no son de nadie');

// ── 13. Puro: sin red, sin reloj, sin IndexedDB, sin DOM ────────────────────
console.log('13. lectura estática');
const sinComentarios = tm.replace(/\/\/.*$/gm, '');
ok(!/\bfetch\s*\(|XMLHttpRequest|setTimeout|setInterval|Date\.now|new Date\(|idb|document\.|window\./.test(sinComentarios), 'util/letras.js no tiene red, reloj, IndexedDB ni DOM');
ok((sinComentarios.match(/^\s*import\b/gm) || []).length === 1, 'importa una sola cosa (track-match.js)');

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
