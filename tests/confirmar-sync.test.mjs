// tests/confirmar-sync.test.mjs — la palabra SYNC solo si hay algo que QUITAR (v=275)
//
// Dos cosas se cuidan:
//   1. La regla (`confirmacionDeSync`): quitar 0 → confirmación simple; quitar ≥1
//      → hay que escribir SYNC; «Solo añadir» NUNCA pide la palabra.
//   2. La estructura de `features/sync.js`: que `executeSync` use esa regla, que
//      el borrado salga del MISMO array que se contó (si dijera 0 y borrara, la
//      regla sería una trampa) y que «Vaciar y llenar» siga pidiendo VACIAR.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { confirmacionDeSync, PALABRA_SYNC } from '../src/js/util/confirmar-sync.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const ok = (c, msg) => { n++; assert.ok(c, msg); };

console.log('La regla');
eq(PALABRA_SYNC, 'SYNC', 'la palabra sigue siendo SYNC');
eq(confirmacionDeSync({ aAnadir: 42, aQuitar: 0 }).tipo, 'simple', 'añadir 42 y quitar 0 → sin palabra');
eq(confirmacionDeSync({ aAnadir: 42, aQuitar: 0 }).palabra, undefined, '…y no trae palabra');
eq(confirmacionDeSync({ aAnadir: 0, aQuitar: 1 }).tipo, 'escritura', 'quitar 1 → pide la palabra');
eq(confirmacionDeSync({ aAnadir: 0, aQuitar: 1 }).palabra, 'SYNC', '…que es SYNC');
eq(confirmacionDeSync({ aAnadir: 5, aQuitar: 7 }).tipo, 'escritura', 'añadir 5 y quitar 7 → pide la palabra');
eq(confirmacionDeSync({ aAnadir: 5, aQuitar: 7 }).quita, 7, '…y dice cuántos quita');
eq(confirmacionDeSync({ modo: 'full', aAnadir: 5, aQuitar: 0 }).tipo, 'simple', 'modo full explícito, quitar 0 → simple');
// «Solo añadir» nunca pide la palabra, ni con un contador de quitar absurdo.
eq(confirmacionDeSync({ modo: 'add-only', aAnadir: 5, aQuitar: 0 }).tipo, 'simple', 'solo añadir → simple');
eq(confirmacionDeSync({ modo: 'add-only', aAnadir: 5, aQuitar: 99 }).tipo, 'simple', 'solo añadir ignora el contador de quitar');
eq(confirmacionDeSync({ modo: 'add-only', aAnadir: 5, aQuitar: 99 }).quita, 0, '…y dice que quita 0');
// Entradas raras: lo dudoso NO baja la guardia salvo que sea 0 de verdad.
eq(confirmacionDeSync({ aAnadir: 1, aQuitar: -3 }).tipo, 'simple', 'negativo no es quitar');
eq(confirmacionDeSync({ aAnadir: 1, aQuitar: 1 }).tipo, 'escritura', 'el borde: 1 ya es quitar');

console.log('\nLa estructura de sync.js');
const src = readFileSync(new URL('../src/js/features/sync.js', import.meta.url), 'utf8');
const ejecutar = src.slice(src.indexOf('async function executeSync'), src.indexOf('async function executeWipeAndFill'));
ok(ejecutar.length > 500, 'encontré executeSync');
ok(/confirmacionDeSync\(\{[^}]*aQuitar:\s*toRemove\.length/.test(ejecutar), 'executeSync decide con el contador de toRemove');
ok(/pide\.tipo === 'escritura'/.test(ejecutar), 'y ramifica por el tipo que devuelve la regla');
ok(/typeConfirmModal\([^)]*pide\.palabra/s.test(ejecutar), 'la rama de escritura pide la palabra de la regla');
ok(!/typeConfirmModal\([^)]*'SYNC'/s.test(ejecutar), 'ya no hay un SYNC suelto escrito a mano en executeSync');
// El número que se enseña y lo que se borra son el MISMO array.
ok(/removeTracksFromPlaylist\(playlist\.id, toRemove\)/.test(ejecutar), 'el DELETE sale de toRemove');
ok(!/removeTracksFromPlaylist/.test(ejecutar.replace(/removeTracksFromPlaylist\(playlist\.id, toRemove\)/, '')),
  'y no hay otro removeTracksFromPlaylist dentro de executeSync');
ok(/if \(mode === 'add-only'\) toRemove = \[\]/.test(ejecutar), 'solo añadir vacía toRemove por dentro');
// Las demás confirmaciones destructivas no se tocaron.
ok(/'VACIAR'/.test(src), '«Vaciar y llenar» sigue pidiendo VACIAR');
ok(/'REHACER'/.test(src), '«Rehacer» sigue pidiendo REHACER');
ok(/'CREAR'/.test(src), '«Crear playlist nueva» sigue pidiendo CREAR');
ok(/btn-secondary btn-lg" id="sync-add-only-btn"/.test(src), 'el botón «Solo añadir (sin quitar)» sigue ahí');

console.log(`\nOK confirmar-sync: ${n} asserts`);
