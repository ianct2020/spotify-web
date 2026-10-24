// tests/topes-versions.test.mjs — los topes de los dos registros de #versions viven en `util/topes-registros.js`
// (tanda 81, v=337)
//
// `versions_supervivientes_perdidas_v1` y `versions_dry_run_log_v1` tenían su tope como un `20` literal dentro de
// `features/versions.js`, y «Importar todo» (`util/copia-importar.js`) los unía SIN tope: un archivo con 50 entradas
// dejaba 51 en `localStorage` hasta la próxima escritura de #versions. Ahora el número vive en `util/topes-registros.js`
// (SIN IMPORTS), la vista y el import lo importan, y el import los une como a los otros dos: las más nuevas primero (por
// `fecha`, la `fechaCampo` de su fila del CENSO), con el tope. Lo que se vigila:
//   · el plan con 50 entradas del archivo y 1 tuya deja 20 (v=336: 51), en los dos registros;
//   · si la clave falta, va tal cual viene (la regla de siempre para TODA clave que falta, también los otros dos);
//   · #versions escribe igual: el mismo tope (20), ahora importado, en las dos escrituras (lectura estática).
//
// 🔴 Todo INVENTADO. Puro: `planDeImport` sin navegador. Contra v=336: 51 en los dos.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const fuente = (p) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const J = JSON.stringify;

const C = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
const CI = await import(pathToFileURL(join(raiz, 'src/js/util/copia-importar.js')).href);
const T = await import(pathToFileURL(join(raiz, 'src/js/util/topes-registros.js')).href);

const UID = 't81-uid-inventado';
const copiaDe = (ls) => ({
  _format: 'spotify-tools-data', _version: 3, _exportedAt: '2026-10-21T10:00:00.000Z', spotifyUserId: UID,
  _likesSource: 'empty', likes: { totalAtExport: 0, items: [] }, tags: { entries: {} }, _config: {},
  _leeme: {}, navegador: { idb: {}, localStorage: ls }, _censo: { version: C.CENSO_VERSION, clases: { idb: {}, localStorage: {} }, fuera: 0, deOtroUsuario: 0, sinCensar: [] }, _errores: [],
});
const plan = (lsArchivo, lsTuyo) => CI.planDeImport({ copia: copiaDe(lsArchivo), idb: {}, ls: { fonoteca_last_user_id: UID, ...lsTuyo }, uid: UID, motivoOwner: null, ahora: new Date('2026-10-24T12:00:00Z') });
const enPlan = (p, k) => p.ls.find(([x]) => x === k);
// 50 entradas inventadas, una por día desde el 1 de agosto (la forma de cada registro, leída en versions.js).
const ensayo = (i) => ({ fecha: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(), simulacro: true, total: 1, ids: [`inv81-${i}`], marcadas: [], borradas: null, supervivientes: null });
const perdida = (i) => ({ fecha: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(), totalBorradas: 2, perdidas: [{ nombre: `tema inventado ${i}`, artista: 'artista inventado' }] });

const REGISTROS = [
  { base: 'versions_dry_run_log_v1', clave: 'versions_dry_run_log_v1', entrada: ensayo },   // sin prefKey (lo escribe así versions.js)
  { base: 'versions_supervivientes_perdidas_v1', clave: `versions_supervivientes_perdidas_v1__${UID}`, entrada: perdida },
];

console.log('· el import, con el tope');
for (const r of REGISTROS) {
  const archivo = Array.from({ length: 50 }, (_, i) => r.entrada(i)).reverse();   // las más nuevas primero, como las guarda la vista
  const tuya = [r.entrada(200)];   // una tuya, más nueva que todas
  const p = plan({ [r.clave]: J(archivo) }, { [r.clave]: J(tuya) });
  const v = JSON.parse(enPlan(p, r.clave)?.[1] || '[]');
  ok(v.length === 20, `🔴 ${r.base}: 50 del archivo + 1 tuya → quedan 20 (${v.length}; v=336: 51)`);
  ok(J(v[0]) === J(tuya[0]) && J(v.slice(1)) === J(archivo.slice(0, 19)), `${r.base}: las más nuevas primero (la tuya y las 19 más nuevas del archivo)`);
  const fila = C.CENSO.find((c) => c.clave === r.base);
  ok(fila?.fusion === 'registro' && fila.fechaCampo === 'fecha', `${r.base}: su fila del CENSO ordena por «fecha»`);

  // La clave que falta va tal cual viene: la regla de toda clave que falta (también likes_borrados_log_v1).
  const p2 = plan({ [r.clave]: J(archivo) }, {});
  ok(JSON.parse(enPlan(p2, r.clave)?.[1] || '[]').length === 50, `${r.base}: si tu navegador no la tiene, entra tal cual (50), como cualquier clave que falta`);
}

console.log('· los topes, importados (no copiados)');
{
  ok(T.SUPERVIVIENTES_PERDIDAS_MAX === 20 && T.ENSAYOS_VERSIONS_MAX === 20, `los dos valen 20, el número de siempre (${T.SUPERVIVIENTES_PERDIDAS_MAX}, ${T.ENSAYOS_VERSIONS_MAX})`);
  const topes = fuente('src/js/util/topes-registros.js');
  ok(!/^import /m.test(topes), 'topes-registros.js sigue sin imports');
  const ver = sinComentarios(fuente('src/js/features/versions.js'));
  ok(/import \{ SUPERVIVIENTES_PERDIDAS_MAX, ENSAYOS_VERSIONS_MAX \} from '\.\.\/util\/topes-registros\.js';/.test(ver), 'versions.js los importa de util/topes-registros.js');
  ok(!/slice\(0, 20\)/.test(ver) && !/\b20\b/.test((ver.match(/localStorage\.setItem\((DRY_LOG_KEY|prefKey\(PERDIDAS_KEY\))[^\n]*/g) || []).join('\n')), 'versions.js ya no tiene el `20` a mano en sus dos escrituras');
  ok(/localStorage\.setItem\(DRY_LOG_KEY, JSON\.stringify\(previo\.slice\(0, ENSAYOS_VERSIONS_MAX\)\)\);/.test(ver), '#versions escribe los ensayos igual: `previo.slice(0, ENSAYOS_VERSIONS_MAX)`');
  ok(/localStorage\.setItem\(prefKey\(PERDIDAS_KEY\), JSON\.stringify\(\[entrada, \.\.\.previo\]\.slice\(0, SUPERVIVIENTES_PERDIDAS_MAX\)\)\);/.test(ver), '#versions escribe las perdidas igual: `[entrada, ...previo].slice(0, SUPERVIVIENTES_PERDIDAS_MAX)`');
  const ci = sinComentarios(fuente('src/js/util/copia-importar.js'));
  ok(/versions_supervivientes_perdidas_v1: SUPERVIVIENTES_PERDIDAS_MAX/.test(ci) && /versions_dry_run_log_v1: ENSAYOS_VERSIONS_MAX/.test(ci), 'el import tiene los dos en `TOPES`, importados');
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
