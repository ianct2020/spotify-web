// tests/likes-diferencia.test.mjs — la cuenta de «Rehacer me gusta desde Spotify» (v=349, tanda 106)
//
// `util/likes-diferencia.js` (sin imports) compara la copia de este navegador con la que acaba de bajar de Spotify por
// `track.uri` DISTINTAS: cuántas tenía la copia que Spotify ya no tiene (`deMas`) y cuántas le faltaban (`faltaban`).
// Los ítems sin `track` o sin `uri` no cuentan. Acá, la función pura sola; los textos del botón, en
// `tests/rehacer-me-gusta.test.mjs`. Todo INVENTADO (el repo es público).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const J = JSON.stringify;

const RUTA = 'src/js/util/likes-diferencia.js';
let M = null;
try { M = await import(pathToFileURL(join(raiz, RUTA)).href); } catch (e) { console.log(`  (no se pudo importar ${RUTA}: ${e.message})`); }
ok(!!M && typeof M.diferenciaDeLikes === 'function', '`diferenciaDeLikes` existe en util/likes-diferencia.js');
const fuente = existsSync(join(raiz, RUTA)) ? readFileSync(join(raiz, RUTA), 'utf8') : '';
ok(fuente.length > 0 && !/^\s*import\s/m.test(fuente) && !/\bimport\s*\(/.test(fuente), 'util/likes-diferencia.js no tiene imports');

if (M?.diferenciaDeLikes) {
  const D = M.diferenciaDeLikes;
  const it = (n) => ({ added_at: '2025-01-01T00:00:00Z', track: { id: `t106inventada${n}`, uri: `spotify:track:t106inventada${n}` } });
  const lista = (...ns) => ns.map(it);

  // Listas inventadas
  let r = D(lista(1, 2, 3), lista(2, 3, 4, 5));
  ok(r.deMas === 1 && r.faltaban === 2, `{u1,u2,u3} contra {u2,u3,u4,u5}: deMas 1 y faltaban 2 (${J(r)})`);
  r = D(lista(1, 2, 3), lista(1, 2, 3));
  ok(r.deMas === 0 && r.faltaban === 0, `iguales: 0 y 0 (${J(r)})`);
  r = D(lista(1, 2, 3), lista(3, 2, 1));
  ok(r.deMas === 0 && r.faltaban === 0, `el orden no cuenta (${J(r)})`);
  const de120 = Array.from({ length: 120 }, (_, i) => it(i + 1));
  const de130 = Array.from({ length: 130 }, (_, i) => it(i + 21));
  r = D(de120, de130);
  ok(r.deMas === 20 && r.faltaban === 30, `{u1..u120} contra {u21..u150}: 20 y 30 (${J(r)})`);
  ok(Object.keys(r).sort().join(',') === 'deMas,faltaban', `devuelve exactamente { deMas, faltaban } (${Object.keys(r).join(',')})`);

  // Uris repetidas: cuentan una vez
  r = D(lista(1, 1, 1, 2), lista(2, 2, 3, 3));
  ok(r.deMas === 1 && r.faltaban === 1, `repetidas cuentan una vez: {u1×3,u2} contra {u2×2,u3×2} → 1 y 1 (${J(r)})`);

  // Ítems sin track o sin uri: no cuentan
  const raros = [null, undefined, {}, { track: null }, { track: {} }, { track: { uri: '' } }, { track: { id: 'sin-uri' } }, { added_at: 'x' }];
  r = D([...lista(1, 2), ...raros], lista(1, 2));
  ok(r.deMas === 0 && r.faltaban === 0, `los sin track o sin uri de la copia no cuentan como «de más» (${J(r)})`);
  r = D(lista(1, 2), [...raros, ...lista(1, 2)]);
  ok(r.deMas === 0 && r.faltaban === 0, `los sin track o sin uri de Spotify no cuentan como «faltaban» (${J(r)})`);
  r = D(raros, raros);
  ok(r.deMas === 0 && r.faltaban === 0, `solo raros de los dos lados: 0 y 0 (${J(r)})`);

  // Las dos vacías, y una vacía y la otra no
  r = D([], []);
  ok(r.deMas === 0 && r.faltaban === 0, `las dos vacías: 0 y 0 (${J(r)})`);
  r = D([], lista(1, 2, 3));
  ok(r.deMas === 0 && r.faltaban === 3, `copia vacía, Spotify con 3: 0 y 3 (${J(r)})`);
  r = D(lista(1, 2, 3), []);
  ok(r.deMas === 3 && r.faltaban === 0, `copia con 3, Spotify vacía: 3 y 0 (${J(r)})`);
  r = D(null, undefined);
  ok(r.deMas === 0 && r.faltaban === 0, `null y undefined se toman como vacías (${J(r)})`);

  // Un conjunto de uris en lugar de la lista (lo que el botón guarda en memoria de la copia)
  if (typeof M.urisDeLikes === 'function') {
    const s = M.urisDeLikes([...lista(1, 2, 3, 3), ...raros]);
    ok(s instanceof Set && s.size === 3 && [...s].every((u) => u.startsWith('spotify:track:t106inventada')), `urisDeLikes: un Set con las 3 uris distintas (${s?.size})`);
    r = D(s, lista(2, 3, 4, 5));
    ok(r.deMas === 1 && r.faltaban === 2, `con el Set de uris de la copia da lo mismo que con la lista (${J(r)})`);
  } else ok(false, '`urisDeLikes` existe');

  // No muta sus argumentos
  const a = lista(1, 2, 3, 3), b = [...lista(2, 4), null, { track: {} }];
  const fa = J(a), fb = J(b), la = a.length, lb = b.length;
  D(a, b);
  ok(J(a) === fa && J(b) === fb && a.length === la && b.length === lb, 'no muta sus argumentos (las dos listas, byte a byte)');
  const sa = new Set(['spotify:track:t106inventada1']);
  D(sa, lista(1, 2));
  ok(sa.size === 1 && sa.has('spotify:track:t106inventada1'), 'no muta el Set que recibe');
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
