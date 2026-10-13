// tests/limpiar-cache.test.mjs — qué se salva de «Limpiar caché» (v=248)
//
// El botón vacía la IndexedDB entera menos una lista. En v=229 se descubrió que
// se llevaba por delante la base de discografías (cuotas enteras de Spotify);
// en v=248 entra en la lista la base de colores del mosaico, por decisión de
// Ian. Este test usa la lista REAL (`util/limpiar-cache.js`) y el filtro REAL
// de `idb.js`, y comprueba además que el botón de `app.js` usa esa lista y no
// una escrita a mano.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clavesABorrar } from '../src/js/idb.js';
import { CONSERVAR_CLAVES, CONSERVAR_PREFIJOS } from '../src/js/util/limpiar-cache.js';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

// Claves con la forma de las que hay en la base real de Ian.
const claves = [
  'mosaico_colores_v1',
  'all_liked_tracks', 'all_liked_tracks_partial',
  'discover_disco_base_v1_0TnOYISbd1XYRBk9myaseg', 'discover_disco_base_v1_3TVXtAsR1Inumwj472S9r4',
  'discover_artist_disco_v2_0TnOYISbd1XYRBk9myaseg', 'discover_artist_id_kanye west',
  'history_stats_v14', 'playlist_items_37i9dQZF1DXcBWIGoYBM5M', 'statsfm_top_lifetime_v1',
  'discover_scan_new-releases', 'mosaico_colores_v0_de_prueba',
];
const borra = new Set(clavesABorrar(claves, CONSERVAR_CLAVES, CONSERVAR_PREFIJOS));

console.log('Lo que se conserva');
ok(!borra.has('mosaico_colores_v1'), 'la base de colores del mosaico');
ok(!borra.has('all_liked_tracks') && !borra.has('all_liked_tracks_partial'), 'los likes y su parcial');
ok(!borra.has('discover_disco_base_v1_0TnOYISbd1XYRBk9myaseg') && !borra.has('discover_disco_base_v1_3TVXtAsR1Inumwj472S9r4'), 'la base de discografías, por prefijo');

console.log('\nLo que se borra');
for (const k of ['discover_artist_disco_v2_0TnOYISbd1XYRBk9myaseg', 'discover_artist_id_kanye west', 'history_stats_v14',
  'playlist_items_37i9dQZF1DXcBWIGoYBM5M', 'statsfm_top_lifetime_v1', 'discover_scan_new-releases']) {
  ok(borra.has(k), k);
}
ok(borra.has('mosaico_colores_v0_de_prueba'), 'la clave del mosaico se conserva por nombre EXACTO, no por prefijo');
ok(!CONSERVAR_PREFIJOS.some(p => p.startsWith('mosaico')), 'y no hay ningún prefijo mosaico_ que pueda arrastrar otras');

console.log('\nEl botón usa esta lista');
const js = [];
const recorrer = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? recorrer(p) : p.endsWith('.js') && js.push(p); } };
recorrer(new URL('../src/js', import.meta.url).pathname);
const llamadas = js.flatMap(p => (readFileSync(p, 'utf8').match(/idbClearAll\([^)]*\)/g) || []).map(m => [p, m]))
  .filter(([p, m]) => !/async function idbClearAll/.test(m) && !p.endsWith('idb.js'));
ok(llamadas.length === 1, `una sola llamada a idbClearAll fuera de idb.js (hay ${llamadas.length})`);
ok(llamadas.every(([, m]) => m === 'idbClearAll(CONSERVAR_CLAVES, CONSERVAR_PREFIJOS)'), `y pasa las dos listas de limpiar-cache.js: ${llamadas.map(([, m]) => m).join(' · ')}`);

// ── El historial importado (v=300, tanda 48) ────────────────────────────────
//
// `saveMyHistory()` y `guardarSoloDias()` escriben `local_<uid>_history_*`, y
// eso no es caché: lo subió el usuario a mano desde su ZIP y no se puede volver
// a bajar. Hasta v=299 «Limpiar caché» se lo llevaba (al owner, el detalle por
// día; a un amigo, las ocho claves). El uid va de prueba: nunca el de Ian.
console.log('\nEl historial importado se conserva (v=300)');
const UID_PRUEBA = 't48-uid-de-prueba';
const conHistorial = [
  ...claves,
  `local_${UID_PRUEBA}_history_days`, `local_${UID_PRUEBA}_history_stats`,
  'ocultos_items_v1_x', 'playlist_items_x', 'discover_scan_x',
];
const borra2 = new Set(clavesABorrar(conHistorial, CONSERVAR_CLAVES, CONSERVAR_PREFIJOS));
ok(!borra2.has(`local_${UID_PRUEBA}_history_days`), 'local_<uid>_history_days se conserva (el detalle por día del owner)');
ok(!borra2.has(`local_${UID_PRUEBA}_history_stats`), 'local_<uid>_history_stats se conserva (el ZIP de un amigo)');
for (const k of ['ocultos_items_v1_x', 'playlist_items_x', 'history_stats_v14', 'discover_scan_x']) {
  ok(borra2.has(k), `${k} se sigue borrando`);
}
const conservadas = conHistorial.filter(k => !borra2.has(k));
console.log(`      ${conHistorial.length} claves antes · ${borra2.size} borradas · ${conservadas.length} conservadas: ${conservadas.join(', ')}`);
const appJs = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8');
ok(appJs.includes('Tus likes, la base de discografías, la de colores del mosaico y el historial que importaste se conservan.'),
  'el toast del botón nombra el historial que importaste');
ok(/entrada\$\{n === 1 \? '' : 's'\}/.test(appJs), 'y el singular/plural de «entrada» se arma como antes');
const limpiarFuente = readFileSync(new URL('../src/js/util/limpiar-cache.js', import.meta.url), 'utf8');
ok(!/['"`]local_/.test(limpiarFuente.replace(/^\s*\/\/.*$/gm, '')), 'limpiar-cache.js no escribe la cadena `local_`: la importa');

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} limpiar-cache: ${pasaron} de ${pasaron + fallaron}`);
if (fallaron) process.exit(1);
