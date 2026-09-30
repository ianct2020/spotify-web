// Suite de la cola de artistas buscados (v=259).
//
// Hasta v=258 «qué artistas quiere escaneados la vista» era un número
// (`loadedMore`). Con el selector pasa a ser un conjunto: los primeros
// `loadedMore` más los elegidos a mano. Lo que cuidan estas pruebas:
//   - que un elegido del fondo NO le quite el sitio a uno de los primeros (el
//     fallo de la cuenta vieja `target - escaneados`);
//   - que el orden siga siendo el de la lista (por likes);
//   - que los elegidos se guarden y se lean sin perder ninguno.

import assert from 'node:assert';

// `storage.js` lee localStorage para la clave por usuario: uno de mentira.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const { artistasBuscados, leerElegidos, sumarElegidos } = await import('../src/js/util/cola-escaneo.js');

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

const lista = Array.from({ length: 10 }, (_, i) => ({ nameLower: `a${i}`, likes: 100 - i }));
const nombres = (xs) => xs.map(a => a.nameLower);

// ── 1. Sin elegidos es exactamente lo de antes ─────────────────────────────
eq(nombres(artistasBuscados(lista, 3)), ['a0', 'a1', 'a2'], 'sin elegidos: los primeros loadedMore');
eq(artistasBuscados(lista, 50).length, 10, 'loadedMore mayor que la lista: la lista entera');
eq(artistasBuscados(lista, 0).length, 0, 'loadedMore 0: nada');
eq(artistasBuscados([], 100).length, 0, 'lista vacía: nada');

// ── 2. Los elegidos del fondo se SUMAN, no desplazan ──────────────────────
{
  const b = artistasBuscados(lista, 3, new Set(['a8', 'a5']));
  eq(nombres(b), ['a0', 'a1', 'a2', 'a5', 'a8'], 'los primeros 3 enteros, y detrás los elegidos en el orden de la lista');
}
eq(nombres(artistasBuscados(lista, 3, new Set(['a1']))), ['a0', 'a1', 'a2'], 'un elegido que ya está entre los primeros no se repite');
eq(nombres(artistasBuscados(lista, 3, new Set(['zz']))), ['a0', 'a1', 'a2'], 'un elegido que ya no es elegible (umbral de likes) no aparece');

// ── 3. Los elegidos persisten y se acumulan ───────────────────────────────
eq([...leerElegidos('x_elegidos')], [], 'sin nada guardado: vacío');
sumarElegidos('x_elegidos', [{ nameLower: 'a8' }]);
sumarElegidos('x_elegidos', [{ nameLower: 'a5' }, { nameLower: 'a8' }, {}]);
eq([...leerElegidos('x_elegidos')].sort(), ['a5', 'a8'], 'se suman sin duplicar y sin perder los de antes');
mem.set('x_roto', '{no es json');
eq([...leerElegidos('x_roto')], [], 'un valor roto se lee como vacío, no tira');

console.log(`OK cola-escaneo: ${n} asserts`);
