// tests/copia-completa.test.mjs — «Exportar todo», la copia completa del navegador (v=333, tanda 78)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=332 lo único que salía del navegador era el «Exportar JSON» (me gusta,
// etiquetas y `_config`) y el «Exportar base» (discografías). Lo demás —entre otras cosas, decisiones del usuario que
// no viven en ningún otro lado— se perdía con el navegador. La copia completa (`util/copia-completa.js` + el enchufe
// `exportarCopiaCompleta()` de `api.js`) lo saca según el CENSO. Acá se vigila:
//   1. con un perfil inventado, `navegador` trae EXACTAMENTE las claves del censo marcadas «entra», del usuario de
//      ahora: ni una más (otro usuario, una clave sin censar, una caché) ni una menos;
//   2. 🔴 el token, el refresh_token, el code_verifier y la key de Last.fm, sembrados con un CANARIO, no aparecen en
//      el texto; y la segunda red los encuentra si el censo se equivocara;
//   3. el texto de un v3 pasado por el `importAllData` de hoy importa lo mismo que un v2 del mismo perfil;
//   4. una clave que falla al leer va a `_errores`, con su nombre, y el resto sale igual;
//   5. 🔴 SOLO LEE: 0 escrituras en IndexedDB y `localStorage` idéntico, y 0 llamadas a `fetch`; y la lectura estática
//      (ni `idbSet*`, ni `idbDel*`, ni `setItem`, ni `removeItem`, ni lo que escribe por debajo);
//   6. los irrecuperables del censo están en el archivo;
//   7. los binarios (la base de colores guarda `Uint8Array`) salen enteros, no como `{"0":…}`.
//
// 🔴 Todo INVENTADO: el repo es público. Corre el `api.js` REAL con `idb.js` y `toast.js` doblados
// (`dobles/loader-copia.mjs`), un `localStorage` de mentira y un `fetch` que cuenta. Contra v=332 no existe
// `util/copia-completa.js` ni `exportarCopiaCompleta`: la suite falla y lo dice.

import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-copia.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const fin = () => { console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };
const fuente = (p) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const lsMapa = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
const red = { llamadas: [], totalLikes: 0 };
globalThis.fetch = async (url) => {
  red.llamadas.push(String(url));
  if (/\/me\/tracks\?limit=1/.test(String(url))) return new Response(JSON.stringify({ total: red.totalLikes, items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 599 });
};
const idbD = () => globalThis.__IDB_COPIA;
function resetear() {
  globalThis.__IDB_COPIA = { kv: new Map(), escrituras: [], fallar: new Set() };
  lsMapa.clear();
}

console.log('· el módulo y el enchufe existen');
const rutaUtil = join(raiz, 'src/js/util/copia-completa.js');
ok(existsSync(rutaUtil), 'src/js/util/copia-completa.js existe');
if (!existsSync(rutaUtil)) fin();
const C = await import(pathToFileURL(rutaUtil).href);
const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href);
ok(typeof api.exportarCopiaCompleta === 'function', 'api.js exporta exportarCopiaCompleta');
if (typeof api.exportarCopiaCompleta !== 'function') fin();

// ── 0. El censo, en sí ──────────────────────────────────────────────────────────────────────────
console.log('· el censo');
const CENSO = C.CENSO;
ok(CENSO.filter((c) => c.clase === 5).length >= 5 && CENSO.filter((c) => c.clase === 5).every((c) => !c.entra), 'los secretos (≥ 5) no entran nunca');
ok(['sp_access_token', 'sp_refresh_token', 'sp_code_verifier', 'sp_token_expiry', 'lastfm_api_key'].every((k) => C.entradaDe('ls', k)?.clase === 5), 'token, refresh_token, code_verifier, expiración y key de Last.fm son clase 5');
ok(CENSO.filter((c) => c.donde === 'ss' || c.donde === 'cache').every((c) => !c.entra), 'nada de sessionStorage ni de la Cache API entra');
ok(CENSO.filter((c) => c.clase === 4).every((c) => !c.entra), 'ninguna caché entra (los me gusta van aparte, en `likes`)');
ok(CENSO.filter((c) => [1, 2, 3, 'preferencia', 'registro'].includes(c.clase)).every((c) => c.entra), 'las clases 1, 2, 3, las preferencias y los registros entran');
const ids = CENSO.map((c) => `${c.donde}:${c.clave}`);
ok(new Set(ids).size === ids.length, 'ninguna clave del censo repetida');
ok(CENSO.every((c) => c.quien && c.que), 'cada fila dice quién la escribe y qué guarda');
const IRREC = CENSO.filter((c) => c.clase === 1).map((c) => c.clave);
ok(['discover_escuchados', 'listened_unreg_dismissed'].every((k) => IRREC.includes(k)), `los dos irrecuperables del encargo están en la clase 1 (${IRREC.length} en total)`);
// Lo que «Limpiar caché» conserva tiene que entrar (si se conserva, no es caché).
const LC = await import(pathToFileURL(join(raiz, 'src/js/util/limpiar-cache.js')).href);
ok(LC.CONSERVAR_PREFIJOS.every((p) => C.entradaDe('idb', p + 'x')?.entra) && LC.CONSERVAR_CLAVES.filter((k) => k !== 'all_liked_tracks' && k !== 'all_liked_tracks_partial').every((k) => C.entradaDe('idb', k)?.entra),
  'todo lo que conserva «Limpiar caché» entra (salvo los me gusta, que van en `likes`)');

// ── El perfil inventado: una clave por fila del censo, más las trampas ──────────────────────────
const UID = 't78-uid-inventado';
const OTRO = 't78-otro-usuario';
const CANARIO = { sp_access_token: 'CANARIO-ACCESS-9f2c71d0', sp_refresh_token: 'CANARIO-REFRESH-4b8e13aa', sp_code_verifier: 'CANARIO-VERIFIER-77d0c2e5', lastfm_api_key: 'CANARIO-LASTFMKEY-1a2b3c4d' };
const LIKES = Array.from({ length: 30 }, (_, i) => ({ added_at: `2026-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`, track: { id: `t${i}`, uri: `spotify:track:t${i}`, name: `Tema inventado ${i}`, artists: [{ id: `a${i % 4}`, name: `Artista ${i % 4}` }], album: { id: `al${i}`, name: `Disco ${i}` } } }));
const etiq = (n) => ({ uid: UID, nombre: n, fuentes: { migrado: null, lastfm: { tags: [{ name: 'género inventado', count: 80 }], fecha: 1_700_000_000_000 }, musicbrainz: null, statsfm: null } });
function claveDeMuestra(c) {
  if (c.porUsuario === 'clave') return c.deUsuario(UID) + (c.deUsuario(UID).endsWith('_') ? 'muestra' : '');
  if (c.prefijo) return c.clave + 'muestra';
  if (c.porUsuario === 'pref') return `${c.clave}__${UID}`;
  return c.clave;
}
function valorDeMuestra(c, k) {
  if (k.startsWith('generos_artista_v1_')) return etiq('artista inventado');
  if (k.startsWith('mapa_artista_v1_')) return { value: { uid: UID, pais: 'XX' }, storedAt: 1, expiry: null };
  if (k === 'mosaico_colores_v1') return { value: { formato: 1, ids: ['x1', 'x2'], host: Uint8Array.from([0, 1]), datos: Uint8Array.from([1, 2, 3, 250, 251, 252]) }, storedAt: 1, expiry: null };
  if (k === 'all_liked_tracks') return { value: LIKES, storedAt: 1, expiry: null };
  if (k === 'generos_artista_migrado_v1') return { uid: UID, fecha: 1, entradas: 0 };
  if (c.donde === 'idb') return { value: { inventado: k }, storedAt: 1, expiry: null };
  if (CANARIO[c.clave]) return CANARIO[c.clave];
  if (c.clave === C.ULTIMO_USUARIO) return UID;
  return JSON.stringify(['valor inventado', k]);
}
const esperadas = { idb: new Set(), ls: new Set() };
function sembrar() {
  resetear();
  for (const c of CENSO) {
    if (c.donde !== 'idb' && c.donde !== 'ls') continue;
    const k = claveDeMuestra(c);
    const v = valorDeMuestra(c, k);
    if (c.donde === 'idb') idbD().kv.set(k, v); else lsMapa.set(k, v);
    if (c.entra) esperadas[c.donde].add(k);
  }
  // Los secretos, también con la clave prefijada de la key de Last.fm.
  lsMapa.set(`lastfm_api_key__${UID}`, CANARIO.lastfm_api_key);
  // Las trampas: otro usuario del mismo navegador, una clave sin censar, y el uid de «abc_x» dentro del rango de «abc».
  lsMapa.set(`discover_escuchados__${OTRO}`, JSON.stringify(['de otro']));
  idbD().kv.set(`local_${OTRO}_history_days`, { value: { otro: 1 }, storedAt: 1, expiry: null });
  idbD().kv.set(`generos_artista_v1_${OTRO}_x`, { ...etiq('x'), uid: OTRO });
  idbD().kv.set(`generos_artista_v1_${UID}_y`, { ...etiq('y'), uid: `${UID}_y` });
  lsMapa.set('t78_clave_sin_censar', 'x');
  idbD().kv.set('t78_idb_sin_censar', { value: 1 });
  idbD().escrituras.length = 0;
}

// ── 1, 2, 5, 6, 7: exportar el perfil ───────────────────────────────────────────────────────────
console.log('· exportar un perfil inventado');
sembrar();
const lsAntes = JSON.stringify([...lsMapa]);
const idbAntes = JSON.stringify([...idbD().kv].map(([k, v]) => [k, C.serializar(v)]));
red.llamadas.length = 0;
const r = await api.exportarCopiaCompleta({ ahora: new Date('2026-10-22T12:00:00Z') });
const copia = r.copia;
const nav = copia.navegador;
const igual = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const deIdb = new Set(Object.keys(nav.idb)), deLs = new Set(Object.keys(nav.localStorage));
ok(igual(deIdb, esperadas.idb), `navegador.idb = exactamente las ${esperadas.idb.size} del censo que entran (vinieron ${deIdb.size}: de más ${[...deIdb].filter((k) => !esperadas.idb.has(k)).join(', ') || '—'}; de menos ${[...esperadas.idb].filter((k) => !deIdb.has(k)).join(', ') || '—'})`);
ok(igual(deLs, esperadas.ls), `navegador.localStorage = exactamente las ${esperadas.ls.size} del censo que entran (vinieron ${deLs.size}: de más ${[...deLs].filter((k) => !esperadas.ls.has(k)).join(', ') || '—'}; de menos ${[...esperadas.ls].filter((k) => !deLs.has(k)).join(', ') || '—'})`);
ok(!deLs.has(`discover_escuchados__${OTRO}`) && !deIdb.has(`local_${OTRO}_history_days`) && !deIdb.has(`generos_artista_v1_${OTRO}_x`) && !deIdb.has(`generos_artista_v1_${UID}_y`), 'nada de otro usuario (tampoco el «abc_x» dentro del rango de «abc»)');
ok(copia._censo.deOtroUsuario === 4, `_censo.deOtroUsuario cuenta las 4 (${copia._censo.deOtroUsuario})`);
ok(copia._censo.sinCensar.includes('ls:t78_clave_sin_censar') && copia._censo.sinCensar.includes('idb:t78_idb_sin_censar') && !('t78_clave_sin_censar' in nav.localStorage),
  'una clave sin censar NO sale: solo su nombre, en _censo.sinCensar');
ok(Object.entries(copia._censo.clases.localStorage).every(([k, cl]) => C.entradaDe('ls', k).clase === cl) && Object.keys(copia._censo.clases.idb).length === deIdb.size,
  '_censo.clases trae la clase de cada clave exportada');
for (const [k, v] of Object.entries(CANARIO)) ok(!r.texto.includes(v), `el canario de ${k} no está en el texto`);
ok(r.secretos.length === 0, 'la segunda red no encontró nada (el censo ya lo había dejado afuera)');
ok(!/sp_access_token|sp_refresh_token|sp_code_verifier/.test(Object.keys(nav.localStorage).join(' ')), 'ninguna clave de la sesión entre las exportadas');
ok(idbD().escrituras.length === 0, `0 escrituras en IndexedDB (${idbD().escrituras.length})`);
ok(JSON.stringify([...lsMapa]) === lsAntes, 'localStorage idéntico antes y después');
ok(JSON.stringify([...idbD().kv].map(([k, v]) => [k, C.serializar(v)])) === idbAntes, 'IndexedDB idéntica antes y después');
ok(red.llamadas.length === 0, `0 llamadas a fetch (${red.llamadas.length})`);
for (const k of IRREC) ok(Object.keys(nav.localStorage).includes(`${k}__${UID}`), `el irrecuperable ${k} está en el archivo`);
const parsed = JSON.parse(r.texto);
const mos = parsed.navegador.idb.mosaico_colores_v1.value;
ok(mos.datos?.__tipo === 'Uint8Array' && Buffer.from(mos.datos.base64, 'base64').equals(Buffer.from([1, 2, 3, 250, 251, 252])) && mos.host.__tipo === 'Uint8Array',
  'los Uint8Array de la base de colores salen en base64 con su tipo, enteros');
ok(parsed._format === 'spotify-tools-data' && parsed._version === 3 && parsed.spotifyUserId === UID && typeof parsed._leeme === 'object' && Array.isArray(parsed._errores) && parsed._errores.length === 0,
  'formato v3: _format, _version 3, spotifyUserId, _leeme y _errores vacío');
ok(Object.keys(C.LEEME).length >= 10 && ['likes', 'tags', '_config', 'navegador', '_censo', '_errores'].every((k) => C.LEEME[k]), '_leeme explica cada parte');
ok(parsed.likes.items.length === LIKES.length && parsed._likesSource === 'full', `likes: los ${LIKES.length} de la caché`);
ok(C.nombreArchivo(new Date(2026, 9, 2, 23, 59)) === 'fonoteca-copia-2026-10-02.json', 'el nombre del archivo, con la fecha local');

// ── 2 bis: la segunda red ───────────────────────────────────────────────────────────────────────
console.log('· la segunda red');
const censoRoto = CENSO.map((c) => (c.clave === 'sp_refresh_token' ? { ...c, clase: 'preferencia', entra: true } : c));
const ls0 = Object.fromEntries(lsMapa);
const copiaRota = await C.armarCopia({ idb: {}, ls: ls0, uid: UID, censo: censoRoto });
const textoRoto = C.serializar(copiaRota);
ok(textoRoto.includes(CANARIO.sp_refresh_token), '(con un censo que se equivoca, el refresh_token se colaría…)');
ok(C.contieneSecreto(textoRoto, ls0).includes('sp_refresh_token'), '…y contieneSecreto lo encuentra, por el nombre');
ok(!JSON.stringify(C.contieneSecreto(textoRoto, ls0)).includes('CANARIO'), 'contieneSecreto devuelve nombres, nunca valores');
const dash = sinComentarios(fuente('src/js/features/dashboard.js'));
const handler = (dash.match(/async function handleExportTodo\(\)[\s\S]*?\n}\n/) || [''])[0];
ok(/r\.secretos\.length\)\s*{[\s\S]*?showToast\([^)]*'error'\);\s*return;/.test(handler) && handler.indexOf('secretos.length') < handler.indexOf('createObjectURL'),
  'el botón NO descarga si hay un secreto: toast rojo y return, antes del Blob');
ok(/data-act="export-todo"[^>]*>Exportar todo <span class="dash-cog-hint">copia de seguridad<\/span>/.test(dash), 'el botón «Exportar todo», con la pista «copia de seguridad»');
ok(/data-act="export-json"[\s\S]{0,200}data-act="export-todo"/.test(dash), '…al lado de «Exportar JSON»');

// ── 4: una clave que falla al leer ──────────────────────────────────────────────────────────────
console.log('· una lectura que falla');
sembrar();
const rota = `discover_disco_base_v1_muestra`;
idbD().fallar.add(rota);
const rf = await api.exportarCopiaCompleta();
ok(rf.errores.length === 1 && rf.errores[0].clave === rota && rf.errores[0].donde === 'idb', `_errores nombra la clave que falló (${JSON.stringify(rf.errores.map((e) => e.clave))})`);
ok(!(rota in rf.copia.navegador.idb) && Object.keys(rf.copia.navegador.idb).length === esperadas.idb.size - 1, 'y el resto de IndexedDB sale igual');
ok(/_errores/.test(handler) || /errores\.length/.test(handler), 'el toast lo dice (el botón mira `errores`)');

// ── 3: v3 contra v2 en el importAllData de hoy ──────────────────────────────────────────────────
console.log('· v3 por el importAllData de hoy, igual que un v2');
sembrar();
const v3 = (await api.exportarCopiaCompleta()).texto;
const v2 = JSON.stringify(await api.exportAllData(UID));
const p2 = JSON.parse(v2), p3 = JSON.parse(v3);
ok(JSON.stringify(p3._config) === JSON.stringify(p2._config) && Object.keys(p2._config).length === 7, `_config igual al del v2 (${Object.keys(p2._config).length} claves)`);
ok(JSON.stringify(p3.tags) === JSON.stringify(p2.tags) && Object.keys(p2.tags.entries).length === 1, 'tags igual al del v2');
ok(JSON.stringify(p3.likes) === JSON.stringify(p2.likes), 'likes igual al del v2');
async function importar(texto) {
  resetear();
  lsMapa.set('sp_access_token', 'tok-del-test'); lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000)); lsMapa.set(C.ULTIMO_USUARIO, UID);
  red.totalLikes = LIKES.length;
  const res = await api.importAllData(JSON.parse(texto), null, { currentUserId: UID });
  const kv = idbD().kv;
  return {
    res,
    likes: JSON.stringify(kv.get('all_liked_tracks')?.value),
    generos: JSON.stringify([...kv].filter(([k]) => k.startsWith('generos_artista_v1_')).map(([k, v]) => [k, v.fuentes.migrado?.tags])),
    config: JSON.stringify(api.CONFIG_LOCAL_KEYS.map((k) => lsMapa.get(`${k}__${UID}`) ?? null)),
  };
}
const i2 = await importar(v2), i3 = await importar(v3);
ok(JSON.stringify(i3.res) === JSON.stringify(i2.res), `el resultado del import, igual (${JSON.stringify(i3.res)})`);
ok(i2.res.likesImported === LIKES.length && i3.likes === i2.likes, 'los mismos me gusta en la caché');
ok(i2.res.tagsImported + i2.res.tagsUpdated === 1 && i3.generos === i2.generos && i3.generos.includes("género inventado"), `las mismas etiquetas (${i2.res.tagsImported} · ${i2.generos} · ${i3.generos})`);
ok(i2.res.configApplied === 7 && i3.config === i2.config, 'el mismo _config aplicado');

// ── 5 bis: la lectura estática ──────────────────────────────────────────────────────────────────
console.log('· lectura estática: leer no escribe');
const util = sinComentarios(fuente('src/js/util/copia-completa.js'));
const apiTxt = sinComentarios(fuente('src/js/api.js'));
const enchufe = (apiTxt.match(/async function exportarCopiaCompleta\([\s\S]*?\n}\n/) || [''])[0];
ok(enchufe.length > 100, 'se encontró el cuerpo de exportarCopiaCompleta');
const PROHIBIDO = /\bidbSet\w*\(|\bidbDel\w*\(|\bidbClearAll\(|setItem\(|removeItem\(|\.clear\(|migratePrefKey|readLocalConfig|getBestAvailableLikes|cargarEtiquetas|exportarEtiquetas|idbGetCached\(|\bput\(|\.delete\(/;
ok(!PROHIBIDO.test(util), `copia-completa.js no escribe (${(util.match(PROHIBIDO) || ['—'])[0]})`);
ok(!PROHIBIDO.test(enchufe), `exportarCopiaCompleta no escribe (${(enchufe.match(PROHIBIDO) || ['—'])[0]})`);
ok(!/fetch\(|spotifyFetch|getCurrentUserId\(|XMLHttpRequest|import\(/.test(util + enchufe + handler), 'ni red ni /me en todo el camino (el uid sale del memo)');
ok(!/document\.|window\.|localStorage\.|indexedDB\./.test(util), 'copia-completa.js es puro: sin DOM, sin storage');
ok(/^import \{[^}]*\} from '\.\/generos-artista\.js';$/m.test(util) && (util.match(/^import /gm) || []).length === 1, 'su único import es generos-artista.js (puro)');

fin();
