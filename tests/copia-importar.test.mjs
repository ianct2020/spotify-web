// tests/copia-importar.test.mjs — «Importar todo», volver a cargar una copia de «Exportar todo» (v=334, tanda 79)
//
// POR QUÉ ESTA SUITE EXISTE: la v=333 saca del navegador lo que la app guarda (11 claves que no se rehacen con nada).
// Una copia que no se puede volver a cargar no es una copia. El import (`util/copia-importar.js` + `importarCopiaCompleta()`
// / `aplicarPlan()` de `api.js`) es la primera vez que la app escribe EN BLOQUE sobre datos que no se pueden rehacer, así
// que lo que se vigila es, ante todo, que NUNCA PISA:
//   1. 🔴 el invariante, por fuerza bruta: estados y copias inventados al azar (semilla fija), cruzados; después del plan,
//      toda clave de antes sigue y su valor contiene el de antes (y lo que la app LEERÍA de cada preferencia, también);
//   2. la vuelta entera: un perfil A con TODAS las filas que entran → «Exportar todo» de la v=333 → un perfil B vacío del
//      mismo uid → B queda con las mismas claves y los mismos valores, los `Uint8Array` byte a byte;
//   3. cada `fusion` del censo, con un caso que une y uno que conserva; `fusionarBases` con dos bases del mismo artista;
//   4. los rechazos (otro uid, sin identidad, un v2, roto) dan un plan vacío;
//   5. la guarda del owner sobre `local_*`, y el bloque de un amigo;
//   6. un archivo editado con un token, con la key de Last.fm y con una clave inventada: ninguna entra, las tres
//      nombradas; y la segunda red, con un plan roto a propósito, no aplica nada;
//   7. el id de una playlist espejo nunca se pisa;
//   8. IndexedDB que falla → 0 escrituras en `localStorage`; una cuota de `localStorage` → para y nombra lo que faltó;
//   9. 0 `fetch` en todo el import;
//  10. la lectura estática: `copia-importar.js` no escribe; en el enchufe, UNA `idbSetVarios` y los `setItem` del plan.
//
// 🔴 Todo INVENTADO: el repo es público. Corre el `api.js` REAL con `idb.js` y `toast.js` doblados
// (`dobles/loader-copia.mjs` de la 78; el doble de IndexedDB ganó `fallarEscritura`), un `localStorage` de mentira y un
// `fetch` que cuenta. Contra v=333 no existe `util/copia-importar.js`: la suite falla y lo dice.

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
const lsCtl = { fallaEn: null, setItems: 0 };
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { if (k === lsCtl.fallaEn) { const e = new Error('QuotaExceededError (doble)'); e.name = 'QuotaExceededError'; throw e; } lsCtl.setItems++; lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
const UID = 't79-test-uid';
const OTRO = 't79-test-otro';
const red = { llamadas: [] };
globalThis.fetch = async (url) => {
  red.llamadas.push(String(url));
  if (/\/v1\/me$/.test(String(url))) return new Response(JSON.stringify({ id: UID }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 599 });
};
const idbD = () => globalThis.__IDB_COPIA;
function resetear() {
  globalThis.__IDB_COPIA = { kv: new Map(), escrituras: [], fallar: new Set(), fallarEscritura: false };
  lsMapa.clear();
  lsCtl.fallaEn = null;
  lsCtl.setItems = 0;
}
// La sesión de mentira: un token que no vence (no se refresca nunca) y el último usuario.
function sesion() {
  lsMapa.set('sp_access_token', 'tok-del-test');
  lsMapa.set('sp_token_expiry', String(Date.now() + 6 * 60 * 60 * 1000));
  lsMapa.set('fonoteca_last_user_id', UID);
}

console.log('· el módulo y el enchufe existen');
const rutaUtil = join(raiz, 'src/js/util/copia-importar.js');
ok(existsSync(rutaUtil), 'src/js/util/copia-importar.js existe');
if (!existsSync(rutaUtil)) fin();
const I = await import(pathToFileURL(rutaUtil).href);
const C = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
const DB = await import(pathToFileURL(join(raiz, 'src/js/util/disco-base.js')).href);
const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href);
ok(typeof api.importarCopiaCompleta === 'function' && typeof api.aplicarPlan === 'function', 'api.js exporta importarCopiaCompleta y aplicarPlan');
if (typeof api.importarCopiaCompleta !== 'function') fin();

// El memo de `getCurrentUserId()`: lo llena UN `/me`, antes de cualquier import (en la app, el Dashboard ya lo pidió).
resetear(); sesion();
await api.getCurrentUserId();
ok(red.llamadas.length === 1, `el memo de getCurrentUserId: 1 /me, antes de importar nada (${red.llamadas.length})`);

const ahora = new Date('2026-10-23T12:00:00Z');
const copiaDe = ({ idb = {}, ls = {}, uid = UID, version = 3 } = {}) => ({
  _format: 'spotify-tools-data', _version: version, _exportedAt: '2026-10-20T10:00:00.000Z', spotifyUserId: uid,
  _likesSource: 'empty', likes: { totalAtExport: 0, items: [] }, tags: { entries: {} }, _config: {},
  _leeme: {}, navegador: { idb, localStorage: ls }, _censo: { version: C.CENSO_VERSION, clases: { idb: {}, localStorage: {} }, fuera: 0, deOtroUsuario: 0, sinCensar: [] }, _errores: [],
});
const plan = (copia, idb = {}, ls = {}, extra = {}) => I.planDeImport({ copia, idb, ls: { fonoteca_last_user_id: UID, ...ls }, uid: UID, motivoOwner: null, ahora, ...extra });
const enPlan = (p, donde, k) => p[donde].find(([x]) => x === k);
const J = JSON.stringify;
const envolver = (value) => ({ value, storedAt: 1_760_000_000_000, expiry: null });

// ── 3. Cada `fusion`, con un caso que une y uno que conserva ──────────────────────────────────────
console.log('· conjunto');
{
  const k = `versions_dismissed__${UID}`;
  const p = plan(copiaDe({ ls: { [k]: J(['b', 'c', 'd']) } }), {}, { [k]: J(['a', 'b']) });
  ok(J(JSON.parse(enPlan(p, 'ls', k)?.[1] || 'null')) === J(['a', 'b', 'c', 'd']), 'une: primero lo tuyo en su orden, después lo del archivo que falte');
  const p2 = plan(copiaDe({ ls: { [k]: J(['b']) } }), {}, { [k]: J(['a', 'b']) });
  ok(!enPlan(p2, 'ls', k) && p2.resumen.claves.tuya.some((x) => x.clave === k), 'conserva: si el archivo no trae nada nuevo, no se escribe');
  const p3 = plan(copiaDe({ ls: { [k]: J(['x']) } }), {}, { [k]: '{roto' });
  ok(!enPlan(p3, 'ls', k), 'tu valor roto no se toca (no es una lista: se queda la tuya)');
  const p4 = plan(copiaDe({ ls: { [k]: '{"no":"lista"}' } }), {}, { [k]: J(['a']) });
  ok(!enPlan(p4, 'ls', k) && p4.resumen.claves.noEntran.some((x) => x.clave === k), 'un valor del archivo que no es una lista no entra, y se nombra');
}
console.log('· mapa');
{
  const k = `skips_hidden_tracks_uris__${UID}`;
  const p = plan(copiaDe({ ls: { [k]: J({ a: 'spotify:track:A2', b: 'spotify:track:B' }) } }), {}, { [k]: J({ a: 'spotify:track:A1' }) });
  ok(J(JSON.parse(enPlan(p, 'ls', k)?.[1] || 'null')) === J({ a: 'spotify:track:A1', b: 'spotify:track:B' }), 'agrega la clave que falta; la que está en los dos con otro valor: gana la tuya');
  const p2 = plan(copiaDe({ ls: { [k]: J({ a: 'spotify:track:OTRA' }) } }), {}, { [k]: J({ a: 'spotify:track:A1' }) });
  ok(!enPlan(p2, 'ls', k), 'conserva: nada que agregar, nada escrito');
  const p3 = plan(copiaDe({ ls: { [k]: '{"__proto__":"spotify:track:P"}' } }), {}, { [k]: J({ a: 'u' }) });
  ok(J(JSON.parse(enPlan(p3, 'ls', k)?.[1] || 'null')) === '{"a":"u","__proto__":"spotify:track:P"}' && Object.getPrototypeOf({}) === Object.prototype, 'una clave «__proto__» del archivo se agrega como clave, sin tocar el prototipo');
}
console.log('· registro');
{
  const k = `likes_borrados_log_v1__${UID}`;
  const e = (f, n) => ({ fecha: f, origen: 'test', total: 1, ids: [`id${n}`], borradas: null });
  const tuyo = [e('2026-10-10T00:00:00Z', 3), e('2026-10-05T00:00:00Z', 1)];
  const p = plan(copiaDe({ ls: { [k]: J([e('2026-10-08T00:00:00Z', 2), e('2026-10-05T00:00:00Z', 1)]) } }), {}, { [k]: J(tuyo) });
  ok(J(JSON.parse(enPlan(p, 'ls', k)?.[1] || 'null').map((x) => x.ids[0])) === J(['id3', 'id2', 'id1']), 'une por entrada exacta, las más nuevas primero');
  const muchas = (desde, n) => Array.from({ length: n }, (_, i) => e(`2026-0${desde}-${String(10 + i).padStart(2, '0')}T00:00:00Z`, desde * 100 + i));
  const p2 = plan(copiaDe({ ls: { [k]: J(muchas(9, 15)) } }), {}, { [k]: J(muchas(8, 15)) });
  const u2 = JSON.parse(enPlan(p2, 'ls', k)?.[1] || '[]');
  ok(u2.length === 20 && u2.every((x) => x.fecha >= '2026-08-15'), `con el tope del dueño (BORRADOS_LOG_MAX = ${u2.length}), quedan las 20 más nuevas`);
  const p3 = plan(copiaDe({ ls: { [k]: J(muchas(1, 5)) } }), {}, { [k]: J(muchas(8, 20)) });
  ok(!enPlan(p3, 'ls', k), 'conserva: si todo lo del archivo es más viejo que lo que el tope deja, no se escribe');
  const kv = 'versions_dry_run_log_v1';
  const p4 = plan(copiaDe({ ls: { [kv]: J(muchas(9, 15)) } }), {}, { [kv]: J(muchas(8, 15)) });
  ok(JSON.parse(enPlan(p4, 'ls', kv)?.[1] || '[]').length === 30, 'los de #versions, sin tope (su tope es un literal de versions.js, que no se tocó)');
  const p5 = plan(copiaDe({ ls: { [k]: J([{ sinFecha: 1 }]) } }), {}, { [k]: J(tuyo) });
  ok(!enPlan(p5, 'ls', k), 'una entrada sin fecha: no hay cómo ordenar, gana la tuya');
  const ki = `ocultos_incidencias_v1__${UID}`;
  const p6 = plan(copiaDe({ ls: { [ki]: J([{ fecha: '2026-10-01T00:00:00Z', tipo: 'x' }]) } }), {}, { [ki]: J([{ fecha: '2026-10-02T00:00:00Z', tipo: 'y' }]) });
  ok(JSON.parse(enPlan(p6, 'ls', ki)?.[1] || '[]').map((x) => x.tipo).join() === 'y,x', 'ocultos_incidencias_v1: une (tope 100, importado de topes-registros.js)');
}
console.log('· discografía (fusionarBases con dos bases del mismo artista)');
{
  const k = 'discover_disco_base_v1_0aAaAaAaAaAaAaAaAaAaAa';
  const al = (id, extra = {}) => ({ id, name: `Lanzamiento ${id}`, total_tracks: 10, images: [{ url: 'u' }], ...extra });
  const base = (items, extra = {}) => ({ v: 1, items, fuente: 'nativo', cortada: false, estimada: false, completaAt: 1, recienteAt: 1, historial: [{ t: 1, via: 'nativo', n: items.length, nuevos: items.length }], ...extra });
  const mia = envolver(base([al('r1'), al('r2', { total_tracks: 0, name: 'Mi nombre' })]));
  const suya = envolver(base([al('r2', { name: 'Otro nombre', total_tracks: 12 }), al('r3')], { cortada: true, historial: [{ t: 2, via: 'busqueda', n: 2, nuevos: 2 }] }));
  const p = plan(copiaDe({ idb: { [k]: suya } }), { [k]: mia });
  const v = enPlan(p, 'idb', k)?.[1];
  const r2 = v?.value.items.find((x) => x.id === 'r2');
  ok(!!v && J(v.value.items.map((x) => x.id).sort()) === J(['r1', 'r2', 'r3']), 'une por id de Spotify: r1, r2, r3');
  ok(r2?.name === 'Mi nombre', 'un campo no vacío tuyo (el nombre) NO cambia aunque el archivo traiga otro');
  ok(r2?.total_tracks === 12, 'un campo tuyo vacío (total_tracks: 0) se llena con el del archivo');
  ok(v?.value.cortada === false && v?.storedAt === mia.storedAt, 'tu base entera sigue entera; el envoltorio es el tuyo');
  const ult = v?.value.historial.at(-1);
  ok(ult?.via === 'importacion' && ult.n === 2 && ult.nuevos === 1, `la entrada del historial cuenta lo del archivo (n=${ult?.n}, nuevos=${ult?.nuevos})`);
  const alReves = DB.fusionarBases(mia.value, suya.value, 5).items.find((x) => x.id === 'r2');
  ok(alReves.name === 'Otro nombre', 'documentado: en el orden de su comentario (a = este navegador), fusionarBases deja que el archivo pise el nombre');
  const p2 = plan(copiaDe({ idb: { [k]: envolver(base([al('r1', { name: 'X' })])) } }), { [k]: mia });
  ok(!enPlan(p2, 'idb', k), 'conserva: si el archivo no trae ningún id nuevo, no se escribe (ni una línea al historial)');
  const p3 = plan(copiaDe({ idb: { [k]: envolver({ items: [{ sinId: 1 }], fuente: 'nativo' }) } }), {});
  ok(!enPlan(p3, 'idb', k) && p3.resumen.claves.noEntran.some((x) => x.clave === k), 'una base que no pasa esBaseValida no entra');
}
console.log('· la tuya gana');
{
  const k = `fonoteca_theme_v1__${UID}`;
  const p = plan(copiaDe({ ls: { [k]: '{"preset":"ambar"}' } }), {}, { [k]: '{"preset":"violeta"}' });
  ok(!enPlan(p, 'ls', k), 'una preferencia distinta: se queda la tuya');
  const p2 = plan(copiaDe({ ls: { [k]: '{"preset":"ambar"}' } }), {}, {});
  ok(enPlan(p2, 'ls', k)?.[1] === '{"preset":"ambar"}', 'si falta, se escribe tal cual viene');
  const kp = `fonoteca_hidden_pl_skips_hidden_tracks__${UID}`;
  const p3 = plan(copiaDe({ ls: { [kp]: 'plDelArchivo0000000000' } }), {}, { [kp]: 'plMio00000000000000000' });
  ok(!enPlan(p3, 'ls', kp), '🔴 fonoteca_hidden_pl_* distinto en el archivo: queda el tuyo (un id guardado nunca se pisa, v=287)');
  const km = 'mapa_area_v1_area-1';
  const p4 = plan(copiaDe({ idb: { [km]: envolver({ pais: 'XX' }) } }), { [km]: envolver({ pais: 'YY' }) });
  ok(!enPlan(p4, 'idb', km), 'IndexedDB: un área distinta, se queda la tuya');
  const kb = 'lastfm_artist_tags_cache';
  const p5 = plan(copiaDe({ idb: { [C.CENSO.find((c) => c.clave === 'generos_artista_migrado_v1').clave]: { uid: UID, fecha: 1, entradas: 0 } } }), {}, { [kb]: '{}' });
  ok(!enPlan(p5, 'idb', 'generos_artista_migrado_v1'), 'la marca de etiquetas migradas NO entra si tu navegador tiene el blob viejo sin migrar');
}
console.log('· las preferencias con prefKey: la pelada y la prefijada son la misma');
{
  const base = 'versions_dismissed', pre = `${base}__${UID}`;
  const p = plan(copiaDe({ ls: { [base]: J(['x']) } }), {}, { [pre]: J(['a']) });
  ok(J(JSON.parse(enPlan(p, 'ls', pre)?.[1] || 'null')) === J(['a', 'x']) && !enPlan(p, 'ls', base), 'la pelada del archivo se une a tu prefijada (escribirla pelada sería escribir algo que migratePrefKey tira)');
  const p2 = plan(copiaDe({ ls: { [pre]: J(['x']) } }), {}, { [base]: J(['a']) });
  ok(J(JSON.parse(enPlan(p2, 'ls', pre)?.[1] || 'null')) === J(['a', 'x']) && !enPlan(p2, 'ls', base), 'tu pelada (sin migrar) se une con la del archivo en la prefijada; tu pelada no se toca');
  const p3 = plan(copiaDe({ ls: { [base]: J(['p']), [pre]: J(['q']) } }), {}, {});
  ok(enPlan(p3, 'ls', base) && enPlan(p3, 'ls', pre), 'si no tienes ninguna de las dos, van las del archivo tal cual');
  const p4 = plan(copiaDe({ ls: { [`${base}__${OTRO}`]: J(['de otro']) } }), {}, {});
  ok(!p4.ls.length && p4.resumen.claves.noEntran.some((x) => x.motivo === 'es de otro usuario'), 'la de otro uid no entra');
}

// ── 4. Los rechazos ──────────────────────────────────────────────────────────────────────────────
console.log('· los rechazos: plan vacío y el motivo');
{
  const c = copiaDe({ ls: { [`versions_dismissed__${UID}`]: J(['a']) } });
  const vacio = (p) => p.idb.length === 0 && p.ls.length === 0 && !!p.rechazo;
  const p1 = I.planDeImport({ copia: copiaDe({ uid: OTRO }), ls: { fonoteca_last_user_id: UID }, uid: UID, ahora });
  ok(vacio(p1) && p1.rechazo.motivo === 'otro-usuario', 'otro uid → plan vacío');
  const p2 = I.planDeImport({ copia: c, ls: { fonoteca_last_user_id: UID }, uid: null, ahora });
  ok(vacio(p2) && p2.rechazo.motivo === 'identidad', 'uid sin confirmar → plan vacío');
  const p3 = I.planDeImport({ copia: c, ls: { fonoteca_last_user_id: UID }, uid: UID, motivoOwner: 'identidad', ahora });
  ok(vacio(p3) && p3.rechazo.motivo === 'identidad', '/me caído (motivo «identidad») → plan vacío');
  const p3b = I.planDeImport({ copia: c, ls: { fonoteca_last_user_id: OTRO }, uid: UID, ahora });
  ok(vacio(p3b) && p3b.rechazo.motivo === 'identidad', 'fonoteca_last_user_id distinto del uid → plan vacío (prefKey armaría otras claves)');
  const p4 = I.planDeImport({ copia: { ...c, _version: 2 }, ls: { fonoteca_last_user_id: UID }, uid: UID, ahora });
  ok(vacio(p4) && p4.rechazo.texto === 'Este archivo es de “Exportar JSON”: cárgalo con “Importar JSON”.', 'un v2 → plan vacío con su mensaje, letra por letra');
  const p5 = I.planDeImport({ copia: { ...c, navegador: undefined }, ls: { fonoteca_last_user_id: UID }, uid: UID, ahora });
  ok(vacio(p5) && p5.rechazo.motivo === 'roto', 'sin `navegador` → roto');
  const p6 = I.planDeImport({ copia: { ...c, _censo: undefined }, ls: { fonoteca_last_user_id: UID }, uid: UID, ahora });
  ok(vacio(p6) && p6.rechazo.motivo === 'roto', 'sin `_censo` → roto');
  const p7 = I.planDeImport({ copia: { ...c, _format: 'otra-cosa' }, ls: { fonoteca_last_user_id: UID }, uid: UID, ahora });
  ok(vacio(p7) && p7.rechazo.motivo === 'formato', 'otro `_format` → plan vacío');
}

// ── 5. La guarda del owner ─────────────────────────────────────────────────────────────────────────
console.log('· la guarda del owner y el bloque de un amigo');
{
  const tipos = ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks', 'days'];
  const idbArch = Object.fromEntries(tipos.map((t) => [`local_${UID}_history_${t}`, envolver({ t })]));
  const c = copiaDe({ idb: idbArch });
  const pO = plan(c, {}, {}, { motivoOwner: 'owner' });
  ok(pO.idb.length === 1 && pO.idb[0][0] === `local_${UID}_history_days`, 'owner: de las ocho, solo entra `days` (si falta)');
  ok(pO.resumen.claves.noEntran.filter((x) => x.clave.startsWith('local_')).length === 7, 'owner: las otras siete, nombradas');
  const pO2 = plan(c, { [`local_${UID}_history_days`]: envolver({ mio: 1 }) }, {}, { motivoOwner: 'owner' });
  ok(pO2.idb.length === 0, 'owner con su detalle por día: no entra nada (days ya está)');
  const pA = plan(c, {}, {});
  ok(pA.idb.length === 8, 'un amigo sin historial: entran las ocho, en bloque');
  const pA2 = plan(c, { [`local_${UID}_history_skip`]: envolver({ mio: 1 }) }, {});
  ok(pA2.idb.length === 0 && pA2.resumen.claves.noEntran.filter((x) => x.clave.startsWith('local_')).length === 8, 'un amigo con UNA de las ocho ya puesta: no entra ninguna (dos historiales no se mezclan)');
}

// ── 6. Un archivo editado a mano ─────────────────────────────────────────────────────────────────
console.log('· un archivo editado: un token, la key de Last.fm y una clave inventada');
{
  const c = copiaDe({ ls: { sp_refresh_token: 'CANARIO-REFRESH', [`lastfm_api_key__${UID}`]: 'CANARIO-LASTFM', t79_inventada: 'x', [`genre_hidden_tags__${UID}`]: J(['ruido']) }, idb: { t79_idb_inventada: 1, [`playlist_items_x`]: envolver([]) } });
  const p = plan(c, {}, {});
  const nombres = p.resumen.claves.noEntran.map((x) => x.clave);
  ok(!p.ls.some(([k]) => ['sp_refresh_token', `lastfm_api_key__${UID}`, 't79_inventada'].includes(k)) && !p.idb.length, 'ninguna de las tres en el plan (ni la caché de IndexedDB ni la inventada)');
  ok(['sp_refresh_token', `lastfm_api_key__${UID}`, 't79_inventada', 't79_idb_inventada', 'playlist_items_x'].every((k) => nombres.includes(k)), 'las cinco, nombradas en el resumen');
  ok(enPlan(p, 'ls', `genre_hidden_tags__${UID}`), 'lo que sí entra, entra igual');
  ok(I.segundaRed({ idb: [], ls: [['sp_refresh_token', 'x']] }).length === 1 && I.segundaRed({ idb: [['t79_x', 1]], ls: [] }).length === 1 && I.segundaRed(p).length === 0, 'la segunda red ve un secreto y una clave sin censar en un plan roto, y deja pasar el bueno');
}

// ── 1. 🔴 El invariante, por fuerza bruta ──────────────────────────────────────────────────────────
console.log('· 🔴 el invariante, por fuerza bruta');
{
  const SEMILLA = 0x79a79;
  let s = SEMILLA;
  const azar = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const uno = (xs) => xs[Math.floor(azar() * xs.length)];
  const algunos = (xs, p = 0.5) => xs.filter(() => azar() < p);
  const LETRAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 1, 2];
  const FECHAS = Array.from({ length: 12 }, (_, i) => `2026-0${1 + (i % 9)}-1${i % 10}T00:00:00Z`);
  const roto = () => uno(['{roto', '"texto"', '[1,{}]', 'null', '{"a":1}']);
  const conj = () => (azar() < 0.1 ? roto() : J(algunos(LETRAS).sort(() => azar() - 0.5)));
  const mapa = () => (azar() < 0.1 ? roto() : J(Object.fromEntries(algunos(['a', 'b', 'c', 'd', 'e']).map((k) => [k, uno(['u1', 'u2', 'u3'])]))));
  const reg = (n = 15) => (azar() < 0.08 ? roto() : J(Array.from({ length: Math.floor(azar() * n) }, () => (azar() < 0.03 ? { sinFecha: 1 } : { fecha: uno(FECHAS), n: Math.floor(azar() * 4) }))));
  const alz = (id) => ({ id, name: uno(['', 'N1', 'N2']), total_tracks: uno([0, 5, 9]), images: azar() < 0.5 ? [] : [{ url: uno(['x', 'y']) }] });
  const disco = () => (azar() < 0.08 ? envolver({ items: [{ sinId: 1 }], fuente: 'nativo' }) : envolver({ v: 1, items: algunos(['r1', 'r2', 'r3', 'r4']).map(alz).concat(azar() < 0.1 ? [{ sinId: uno(['p', 'q']) }] : []), fuente: uno(['nativo', 'busqueda']), cortada: azar() < 0.5, estimada: false, completaAt: Math.floor(azar() * 9), recienteAt: Math.floor(azar() * 9), historial: [{ t: Math.floor(azar() * 9), via: 'nativo', n: 1, nuevos: 1 }] }));
  const texto = () => uno(['A', 'B', '{"x":1}', '']);
  // Las filas que se sortean: [donde, base, ¿prefKey?, generador].
  const FILAS = [
    ['ls', 'discover_escuchados', true, conj], ['ls', 'versions_dismissed', true, conj], ['ls', 'skips_hidden_tracks', true, conj],
    ['ls', 'skips_hidden_tracks_uris', true, mapa], ['ls', 'discover_escuchados_uris', true, mapa],
    ['ls', 'likes_borrados_log_v1', true, () => reg(16)], ['ls', 'ocultos_incidencias_v1', true, () => reg(8)], ['ls', 'versions_dry_run_log_v1', false, reg],
    ['ls', 'fonoteca_hidden_pl_skips_hidden_tracks', true, texto], ['ls', 'fonoteca_theme_v1', true, texto], ['ls', 'versions_dry_run', false, texto], ['ls', 'ocultos_sin_uri_v1', true, texto],
    ['ls', 'discoverart_fallos', true, texto], ['ls', 'lastfm_artist_tags_cache', false, () => '{}'],
  ];
  const IDB = [
    ['discover_disco_base_v1_0aAaAaAaAaAaAaAaAaAaAa', disco], ['discover_disco_base_v1_1bBbBbBbBbBbBbBbBbBbBb', disco],
    ['mapa_area_v1_area-1', () => envolver({ pais: uno(['XX', 'YY']) })], [`generos_artista_v1_${UID}_artista inventado`, () => ({ uid: UID, nombre: 'artista inventado', fuentes: { lastfm: { tags: [{ name: uno(['g1', 'g2']), count: 1 }], fecha: 1 } } })],
    [`local_${UID}_history_days`, () => envolver({ d: uno([1, 2]) })], [`local_${UID}_history_stats`, () => envolver({ s: uno([1, 2]) })],
    ['mosaico_colores_v1', () => envolver({ datos: Uint8Array.from([uno([1, 2]), 3, 4]) })], ['generos_artista_migrado_v1', () => ({ uid: UID, fecha: 1, entradas: 0 })],
  ];
  function estadoAlAzar(archivo) {
    const idb = {}, ls = {};
    for (const [donde, base, pref, gen] of FILAS) {
      if (pref) {
        const forma = uno(['nada', 'nada', 'pel', 'pre', 'pre', 'ambas']);
        if (forma === 'pel' || forma === 'ambas') ls[base] = gen();
        if (forma === 'pre' || forma === 'ambas') ls[`${base}__${UID}`] = gen();
        if (archivo && azar() < 0.1) ls[`${base}__${OTRO}`] = gen();
      } else if (azar() < 0.6) ls[base] = gen();
    }
    for (const [k, gen] of IDB) if (azar() < 0.5) idb[k] = gen();
    if (archivo) {
      if (azar() < 0.2) ls.sp_refresh_token = 'CANARIO';
      if (azar() < 0.2) ls.t79_inventada = 'x';
      if (azar() < 0.2) idb.playlist_items_x = envolver([]);
    } else {
      ls.fonoteca_last_user_id = UID;
      if (azar() < 0.3) ls.t79_ajena_sin_censar = 'mia';
      if (azar() < 0.3) idb.t79_ajena_idb = envolver({ mia: 1 });
    }
    return { idb, ls };
  }
  const NE = 150, NC = 150;
  const estados = Array.from({ length: NE }, () => estadoAlAzar(false));
  const copias = Array.from({ length: NC }, () => { const { idb, ls } = estadoAlAzar(true); return C.serializar(copiaDe({ idb, ls })); });   // como sale del export
  const ser = (v) => C.serializar(v);
  const lista = (t) => { try { const v = JSON.parse(t); return Array.isArray(v) ? v : null; } catch { return null; } };
  const obj = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  const TOPE = { likes_borrados_log_v1: 20, ocultos_incidencias_v1: 100 };
  // ¿`despues` contiene a `antes`, según la `fusion` de su fila?
  function contiene(c, antes, despues) {
    if (despues === undefined) return false;
    const igual = ser(antes) === ser(despues);
    if (!c || igual) return igual;
    if (c.fusion === 'conjunto') {
      const a = lista(antes), d = lista(despues);
      if (!a || !a.every((x) => typeof x === 'string' || typeof x === 'number')) return igual;
      return !!d && a.every((x) => d.some((y) => y === x));
    }
    if (c.fusion === 'mapa') {
      const a = obj(antes), d = obj(despues);
      if (!a || !Object.values(a).every((x) => typeof x === 'string')) return igual;
      return !!d && Object.entries(a).every(([k, v]) => d[k] === v);
    }
    if (c.fusion === 'registro') {
      const a = lista(antes), d = lista(despues);
      if (!a) return igual;
      if (!d) return false;
      const firmas = new Set(d.map(J));
      const tope = TOPE[c.clave.replace(/__.*$/, '')];
      return a.every((e) => firmas.has(J(e)) || (tope && d.length === tope && d.every((x) => x.fecha >= e.fecha)));
    }
    if (c.fusion === 'discografia') {
      if (!DB.esBaseValida(antes?.value)) return igual;
      if (!DB.esBaseValida(despues?.value) || despues.storedAt !== antes.storedAt || despues.expiry !== antes.expiry) return false;
      const vacio = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || v === 0;
      return antes.value.items.every((it) => {
        const d = despues.value.items.find((x) => x.id === it.id);
        return d && Object.entries(it).every(([k, v]) => vacio(v) || ser(d[k]) === ser(v));
      });
    }
    return false;   // 'la tuya gana': solo vale igual
  }
  let casos = 0, conEscritura = 0, uniones = 0, agregados = 0, fallas = [];
  for (const est of estados) {
    for (const texto of copias) {
      casos++;
      const copia = I.leerCopia(texto);
      const motivoOwner = azar() < 0.2 ? 'owner' : null;
      const p = I.planDeImport({ copia, idb: est.idb, ls: est.ls, uid: UID, motivoOwner, ahora });
      if (p.rechazo) { fallas.push(`rechazo inesperado: ${p.rechazo.motivo}`); continue; }
      if (I.segundaRed(p).length) fallas.push(`la segunda red saltó: ${I.segundaRed(p).join()}`);
      const despues = { idb: { ...est.idb }, ls: { ...est.ls } };
      for (const [k, v] of p.idb) despues.idb[k] = structuredClone(v);
      for (const [k, v] of p.ls) despues.ls[k] = v;
      if (p.idb.length + p.ls.length) conEscritura++;
      uniones += p.resumen.claves.unen.length; agregados += p.resumen.claves.agregan.length;
      for (const donde of ['idb', 'ls']) {
        for (const [k, v] of Object.entries(est[donde])) {
          if (!contiene(C.entradaDe(donde, k), v, despues[donde][k])) fallas.push(`${donde}:${k}`);
        }
      }
      // Y lo que la app LEERÍA de cada preferencia (la prefijada o, si no hay, la pelada: `migratePrefKey`).
      for (const [, base, pref] of FILAS) {
        if (!pref) continue;
        const ef = (ls) => ls[`${base}__${UID}`] ?? ls[base];
        if (ef(est.ls) !== undefined && !contiene(C.entradaDe('ls', base), ef(est.ls), ef(despues.ls))) fallas.push(`efectiva:${base}`);
      }
      for (const [k] of p.ls) if (['sp_refresh_token', 't79_inventada'].includes(k) || k.endsWith(`__${OTRO}`)) fallas.push(`entró ${k}`);
    }
  }
  console.log(`    semilla 0x${SEMILLA.toString(16)} · ${NE} estados × ${NC} copias = ${casos.toLocaleString('es-ES')} casos · con escritura ${conEscritura.toLocaleString('es-ES')} · ${agregados.toLocaleString('es-ES')} claves agregadas · ${uniones.toLocaleString('es-ES')} unidas`);
  globalThis.__FUERZA_BRUTA = { semilla: SEMILLA, casos, conEscritura, agregados, uniones };
  ok(casos === NE * NC && uniones > 1000 && agregados > 1000, `la fuerza bruta corrió de verdad (${casos} casos, ${uniones} uniones, ${agregados} agregados)`);
  ok(fallas.length === 0, `🔴 el invariante: toda clave de antes sigue y contiene lo que tenía (fallas: ${fallas.length}${fallas.length ? ' · ' + [...new Set(fallas)].slice(0, 6).join(' · ') : ''})`);
}

// ── 2. La vuelta entera: A → «Exportar todo» (v=333) → B vacío ────────────────────────────────────
console.log('· la vuelta entera: A → Exportar todo → B vacío del mismo uid');
let textoA = '';
{
  resetear(); sesion();
  const kv = idbD().kv;
  const L = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const id22 = (i, p = 'x') => (p + String(i).padStart(21, '0')).slice(0, 22);
  const valorLs = (c) => {
    if (c.fusion === 'conjunto') return J(L(5, (i) => `${c.clave} inventado ${i}`));
    if (c.fusion === 'mapa') return J(Object.fromEntries(L(3, (i) => [`clave inventada ${i}`, `spotify:track:${id22(i, 'u')}`])));
    if (c.fusion === 'registro') return J(L(3, (i) => ({ fecha: `2026-10-0${i + 1}T00:00:00.000Z`, inventado: i })));
    if (c.clave === 'ocultos_sin_uri_v1') return J({ 'skips_hidden_tracks::clave inventada': { desde: 1, intentos: 2, ultimoIntento: 3 } });
    return J({ preferenciaInventada: c.clave });
  };
  const esperadas = new Map();
  for (const c of C.CENSO) {
    if (!c.entra) continue;
    if (c.donde === 'ls') {
      const k = c.porUsuario === 'pref' ? `${c.clave}__${UID}` : c.clave;
      lsMapa.set(k, valorLs(c)); esperadas.set(`ls:${k}`, k);
    } else {
      const k = c.porUsuario === 'clave' ? c.deUsuario(UID) + (c.clave === 'local_' ? 'days' : 'muestra') : c.prefijo ? c.clave + 'muestra' : c.clave;
      let v;
      if (c.clave === 'mosaico_colores_v1') v = envolver({ formato: 1, ids: L(4, (i) => id22(i, 'c')), host: Uint8Array.from([0, 1, 2, 0]), datos: Uint8Array.from(L(108, (i) => (i * 37) % 256)) });
      else if (c.fusion === 'discografia') v = envolver({ v: 1, items: L(3, (j) => ({ id: id22(j, 'r'), name: `Lanzamiento inventado ${j}` })), fuente: 'nativo', cortada: false, estimada: false, completaAt: 1, recienteAt: 1, historial: [] });
      else if (c.clave.startsWith('generos_artista_v1_')) v = { uid: UID, nombre: 'muestra', fuentes: { lastfm: { tags: [{ name: 'género inventado', count: 9 }], fecha: 1 } } };
      else if (c.clave === 'generos_artista_migrado_v1') v = { uid: UID, fecha: 1, entradas: 0 };
      else v = envolver({ uid: c.porUsuario === 'clave' ? UID : undefined, inventado: k });
      kv.set(k, v); esperadas.set(`idb:${k}`, k);
    }
  }
  // Las ocho del historial de un amigo, y una pelada (la de antes de saber el uid) para ver que viaja tal cual.
  for (const t of ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks']) { kv.set(`local_${UID}_history_${t}`, envolver({ t })); esperadas.set(`idb:local_${UID}_history_${t}`, `local_${UID}_history_${t}`); }
  lsMapa.set('newrel_months', '6'); esperadas.set('ls:newrel_months', 'newrel_months');
  const irrec = C.CENSO.filter((c) => c.clase === 1).length;
  const A = { idb: new Map([...kv].map(([k, v]) => [k, C.serializar(v)])), ls: new Map(lsMapa) };
  const r = await api.exportarCopiaCompleta({ ahora });
  textoA = r.texto;
  ok(r.secretos.length === 0 && r.errores.length === 0, 'el export de la v=333 sale sin secretos ni errores');

  // B: vacío, el mismo uid. Solo la sesión.
  resetear(); sesion();
  const llamadasAntes = red.llamadas.length;
  const { plan: p } = await api.importarCopiaCompleta(textoA, { ahora });
  ok(!p.rechazo, `B acepta la copia (${p.rechazo?.texto || 'sin rechazo'})`);
  ok(idbD().escrituras.length === 0 && lsCtl.setItems === 0, 'importarCopiaCompleta no escribe nada (es «Cancelar»: el plan sin aplicar)');
  const res = await api.aplicarPlan(p);
  ok(res.ok, `aplicarPlan ok (${res.idb} en IndexedDB, ${res.ls} en localStorage)`);
  ok(red.llamadas.length === llamadasAntes, `🔴 0 fetch en todo el import (${red.llamadas.length - llamadasAntes})`);
  ok(idbD().escrituras.filter(([t]) => t === 'del').length === 0, '0 borrados en IndexedDB');
  const faltan = [], distintas = [];
  for (const [id, k] of esperadas) {
    const [donde] = id.split(':');
    const a = donde === 'idb' ? A.idb.get(k) : A.ls.get(k);
    const b = donde === 'idb' ? (kv.has(k) ? C.serializar(idbD().kv.get(k)) : undefined) : lsMapa.get(k);
    if (b === undefined) faltan.push(id); else if (a !== b) distintas.push(id);
  }
  ok(faltan.length === 0, `B tiene TODAS las claves de A que entran (${esperadas.size}; faltan: ${faltan.join(', ') || '—'})`);
  ok(distintas.length === 0, `con los mismos valores (distintas: ${distintas.join(', ') || '—'})`);
  const mos = idbD().kv.get('mosaico_colores_v1')?.value;
  ok(mos?.datos instanceof Uint8Array && mos.host instanceof Uint8Array && mos.datos.length === 108 && mos.datos.every((b, i) => b === (i * 37) % 256), 'los Uint8Array de la base de colores, de vuelta a su tipo y byte a byte');
  ok(C.CENSO.filter((c) => c.clase === 1).every((c) => lsMapa.has(`${c.clave}__${UID}`)) && lsMapa.has(`ocultos_sin_uri_v1__${UID}`), `las ${irrec} irrecuperables y ocultos_sin_uri_v1, en B`);
  ok(lsMapa.get('sp_access_token') === 'tok-del-test' && !lsMapa.has('all_liked_tracks') && !idbD().kv.has('all_liked_tracks'), 'la sesión de B es la de B, y los me gusta no viajan (se vuelven a bajar de Spotify)');
  ok(res.resumen.claves.agregan.length === esperadas.size && res.resumen.claves.unen.length === 0, `en un B vacío todo se agrega (${res.resumen.claves.agregan.length}) y nada se une`);
}

// ── 8. Cuando algo falla al escribir ─────────────────────────────────────────────────────────────
console.log('· IndexedDB que falla, una cuota de localStorage y un plan roto');
{
  resetear(); sesion();
  lsMapa.set(`versions_dismissed__${UID}`, J(['mio']));
  const fotoLs = () => J([...lsMapa].sort());
  const { plan: p } = await api.importarCopiaCompleta(textoA, { ahora });
  idbD().fallarEscritura = true;
  const antes = fotoLs(), setAntes = lsCtl.setItems;
  const r = await api.aplicarPlan(p);
  ok(!r.ok && r.motivo === 'idb' && fotoLs() === antes && lsCtl.setItems === setAntes && idbD().kv.size === 0, '🔴 IndexedDB que falla → 0 escrituras en localStorage (y en IndexedDB)');

  idbD().fallarEscritura = false;
  const claves = p.ls.map(([k]) => k);
  lsCtl.fallaEn = claves[3];
  const r2 = await api.aplicarPlan(p);
  ok(!r2.ok && r2.motivo === 'ls' && r2.ls === 3 && r2.faltaron[0] === claves[3] && r2.faltaron.length === claves.length - 3, `una cuota a mitad: para ahí y nombra las ${r2.faltaron?.length} que faltaron`);
  ok(J(JSON.parse(lsMapa.get(`versions_dismissed__${UID}`))).includes('"mio"'), 'y lo que ya tenías sigue ahí');

  resetear(); sesion();
  const { plan: p3 } = await api.importarCopiaCompleta(textoA, { ahora });
  p3.ls.push(['sp_refresh_token', 'CANARIO-ROTO']);
  const r3 = await api.aplicarPlan(p3);
  ok(!r3.ok && r3.motivo === 'red' && idbD().escrituras.length === 0 && lsCtl.setItems === 0 && lsMapa.get('sp_refresh_token') !== 'CANARIO-ROTO', '🔴 la segunda red: un plan con un secreto metido a mano no aplica NADA');

  resetear(); sesion();
  const otra = JSON.parse(textoA); otra.spotifyUserId = OTRO;
  const { plan: p4 } = await api.importarCopiaCompleta(JSON.stringify(otra));
  const r4 = await api.aplicarPlan(p4);
  ok(p4.rechazo?.motivo === 'otro-usuario' && !r4.ok && idbD().escrituras.length === 0 && lsCtl.setItems === 0, 'la copia de otro usuario: ni el plan ni el aplicar escriben nada');
  const { plan: p5 } = await api.importarCopiaCompleta('{esto no es json');
  ok(p5.rechazo?.motivo === 'roto' && /JSON/.test(p5.rechazo.texto), 'un archivo que no es JSON: roto, con el porqué');
  idbD().fallar.add(`versions_dismissed__${UID}`); idbD().kv.set('t79_lectura_rota', 1); idbD().fallar.add('t79_lectura_rota');
  const { plan: p6 } = await api.importarCopiaCompleta(textoA, { ahora });
  ok(p6.rechazo?.motivo === 'lectura' && p6.ls.length === 0 && p6.idb.length === 0, 'si leer lo que ya tienes falla en una clave, no se carga nada');
}

// ── 10. La lectura estática ──────────────────────────────────────────────────────────────────────
console.log('· lectura estática');
{
  const util = sinComentarios(fuente('src/js/util/copia-importar.js'));
  const apiTxt = sinComentarios(fuente('src/js/api.js'));
  const cuerpo = (nombre, txt = apiTxt) => (txt.match(new RegExp(`(?:async )?function ${nombre}\\([\\s\\S]*?\\n}\\n`)) || [''])[0];
  const enchufe = ['leerParaImportar', 'leerLsAhora', 'importarCopiaCompleta', 'aplicarPlan'].map((n) => cuerpo(n));
  ok(enchufe.every((b) => b.length > 80), 'se encontraron los cuatro cuerpos del enchufe');
  const ESCRIBE = /\bidbSet\w*\(|\bidbDel\w*\(|\bidbClearAll\(|setItem\(|removeItem\(|\.clear\(|migratePrefKey|readLocalConfig|applyLocalConfig|getBestAvailableLikes|cargarEtiquetas|importarEtiquetas|importAllData|importLikesData|idbGetCached\(|\bput\(|\.delete\(/;
  ok(!ESCRIBE.test(util), `copia-importar.js no escribe (${(util.match(ESCRIBE) || ['—'])[0]})`);
  ok(!/document\.|window\.|localStorage\.|indexedDB\.|fetch\(|XMLHttpRequest|import\(/.test(util), 'copia-importar.js es puro: sin DOM, sin storage, sin red');
  const imps = util.match(/^import .* from '([^']+)';$/gm) || [];
  ok(imps.length === 4 && imps.every((l) => /'\.\/(copia-completa|disco-base|generos-artista|topes-registros)\.js'/.test(l)), 'sus imports son los cuatro módulos puros');
  const todo = enchufe.join('\n');
  ok((todo.match(/idbSetVarios\(/g) || []).length === 1, 'en el enchufe, UNA sola idbSetVarios');
  ok((todo.match(/setItem\(/g) || []).length === 1 && /for \(const \[clave, texto\] of final\.ls\) \{\s*try \{\s*localStorage\.setItem\(clave, texto\);/.test(todo), 'y un solo setItem: el de las claves del plan');
  const OTRAS = /\bidbSet(?!Varios)\w*\(|\bidbDel\w*\(|\bidbClearAll\(|removeItem\(|\.clear\(|migratePrefKey|readLocalConfig|applyLocalConfig|getBestAvailableLikes|importAllData|importLikesData|importarEtiquetas|idbGetCached\(|fetch\(|spotifyFetch|getCurrentUserId\(/;
  ok(!OTRAS.test(todo), `ni un removeItem, ni un idbDel, ni importAllData, ni red (${(todo.match(OTRAS) || ['—'])[0]})`);
  const lectura = (b) => (b.match(/leerNavegador\(\{[\s\S]*?\}\)/) || [''])[0];
  ok(lectura(cuerpo('leerParaImportar')).length > 50 && lectura(cuerpo('leerParaImportar')) === lectura(cuerpo('exportarCopiaCompleta')), 'lee con las MISMAS lecturas que exportarCopiaCompleta, letra por letra');
  const dash = sinComentarios(fuente('src/js/features/dashboard.js'));
  const handler = cuerpo('handleImportTodo', dash);
  ok(handler.length > 200 && !/setItem\(|removeItem\(|\bidb\w*\(|importAllData/.test(handler), 'el handler no escribe por su cuenta (todo pasa por aplicarPlan)');
  ok(/if \(!ok\) return;/.test(handler) && handler.indexOf('if (!ok) return;') < handler.indexOf('aplicarPlan('), '«Cancelar» vuelve antes de aplicarPlan: 0 escrituras');
  // (v=335, tanda 80) Hasta v=334 decía «sin recarga automática: solo «Recargar ahora»». La 80 la hizo OBLIGADA: el modal
  // del resultado no ofrece «Cerrar» y, se cierre como se cierre, la pestaña recarga (ver `tests/importar-recarga.test.mjs`).
  // (v=336, tanda 81) Reescrito a propósito: hasta v=335 había UN `location.reload`. Ahora son dos, el del import entero y
  // el del import a medias (`importar-a-medias.test.mjs`); cada uno va justo después de su modal sin «Cerrar».
  const recargas = handler.match(/location\.reload/g) || [];
  const trasModal = handler.match(/cancelText: null, variant: '(info|warning)' \}\);\s*location\.reload\(\);/g) || [];
  ok(/cancelText: null, variant: 'info' \}\);\s*location\.reload\(\);\s*\}\s*$/.test(handler) && recargas.length === 2 && trasModal.length === 2, 'la recarga es obligada: cada location.reload (el entero y el a medias), sin condición, después de su modal sin «Cerrar»');
  ok(/data-act="export-todo"[^\n]*\n\s*<button class="dash-cog-item" data-act="import-todo" role="menuitem">Importar todo <span class="dash-cog-hint">cargar una copia<\/span><\/button>/.test(fuente('src/js/features/dashboard.js')), '«Importar todo» con la pista «cargar una copia», debajo de «Exportar todo»');
  ok(C.LEEME['cómo se vuelve a cargar'] === '⚙ del Dashboard → “Importar todo”. Solo agrega lo que falta y une las listas: nunca borra ni cambia lo que ya tienes.', '_leeme dice cómo se vuelve a cargar');
  ok(C.CENSO.filter((c) => c.entra).every((c) => ['conjunto', 'mapa', 'registro', 'discografia', 'la tuya gana'].includes(c.fusion)) && C.CENSO.filter((c) => !c.entra).every((c) => !c.fusion), 'cada fila que entra tiene su `fusion`; las que no, no');
  ok(C.CENSO.filter((c) => c.fusion === 'registro').every((c) => c.fechaCampo), 'cada registro dice su campo de fecha');
  const topes = fuente('src/js/util/topes-registros.js');
  ok(!/^import /m.test(topes) && /import \{ BORRADOS_LOG_MAX \} from '\.\/util\/topes-registros\.js';/.test(fuente('src/js/api.js')) && /import \{ INCIDENCIAS_OCULTOS_MAX \} from '\.\/topes-registros\.js';/.test(fuente('src/js/util/hidden-sync.js')), 'los topes viven en un módulo sin imports y sus dueños los importan de ahí (no copiados)');
}

fin();
