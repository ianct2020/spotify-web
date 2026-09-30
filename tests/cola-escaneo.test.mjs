// Suite de la cola de artistas buscados (v=259).
//
// Hasta v=258 «qué artistas quiere escaneados la vista» era un número
// (`loadedMore`). Con el selector pasa a ser un conjunto: los primeros
// `loadedMore` más los elegidos a mano. Lo que cuidan estas pruebas:
//   - que el conjunto sume los elegidos detrás de los primeros, en el orden de
//     la lista (por likes);
//   - que la cola AUTOMÁTICA sea exactamente la de v=258 sin elegidos: la
//     versión «conjunto» de v=259 encoló un hueco en producción y gastó cuota
//     sin preguntar (30/09);
//   - que los elegidos se guarden y se lean sin perder ninguno.

import assert from 'node:assert';

// `storage.js` lee localStorage para la clave por usuario: uno de mentira.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const { artistasBuscados, colaAutomatica, leerElegidos, sumarElegidos } = await import('../src/js/util/cola-escaneo.js');

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

const lista = Array.from({ length: 10 }, (_, i) => ({ nameLower: `a${i}`, likes: 100 - i }));
const nombres = (xs) => xs.map(a => a.nameLower);

// ── 1. Sin elegidos es exactamente lo de antes ─────────────────────────────
eq(nombres(artistasBuscados(lista, 3)), ['a0', 'a1', 'a2'], 'sin elegidos: los primeros loadedMore');
eq(artistasBuscados(lista, 50).length, 10, 'loadedMore mayor que la lista: la lista entera');
eq(artistasBuscados(lista, 0).length, 0, 'loadedMore 0: nada');
eq(artistasBuscados([], 100).length, 0, 'lista vacía: nada');

// ── 2. Los elegidos del fondo se suman al conjunto ───────────────────────
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

// ── 4. La cola automática: el caso de producción del 30/09 ─────────────────
//
// Objetivo 3, escaneados a0, a2 y a5 (a5 fuera de los primeros), hueco en a1.
// v=258 no pedía nada (3 - 3 = 0); la cola «conjunto» pedía a1 en cada apertura.
{
  const l = lista.map(a => ({ ...a, scanned: ['a0', 'a2', 'a5'].includes(a.nameLower) }));
  const escaneados = l.filter(a => a.scanned).length;
  eq(nombres(colaAutomatica(artistasBuscados(l, 3), escaneados)), [], 'con el objetivo cubierto no encola el hueco');
  const l2 = lista.map(a => ({ ...a, scanned: a.nameLower === 'a0' }));
  eq(nombres(colaAutomatica(artistasBuscados(l2, 3), 1)), ['a1', 'a2'], 'faltan dos: encola los dos primeros sin escanear');
  // Un elegido sin escanear suma un sitio; ya escaneado, no pide nada.
  const l3 = lista.map(a => ({ ...a, scanned: ['a0', 'a1', 'a2'].includes(a.nameLower) }));
  eq(nombres(colaAutomatica(artistasBuscados(l3, 3, new Set(['a7'])), 3)), ['a7'], 'un elegido sin escanear entra en la cola');
  const l4 = l3.map(a => ({ ...a, scanned: a.scanned || a.nameLower === 'a7' }));
  eq(nombres(colaAutomatica(artistasBuscados(l4, 3, new Set(['a7'])), 4)), [], 'y ya escaneado no pide nada');
}

// Sin elegidos, idéntica a la fórmula de v=258 en TODOS los estados de 8
// artistas (256 combinaciones de escaneado) y objetivos de 0 a 9.
{
  let iguales = 0, casos = 0;
  for (let m = 0; m < 256; m++) {
    const l = Array.from({ length: 8 }, (_, i) => ({ nameLower: `b${i}`, scanned: !!(m & (1 << i)) }));
    const escaneados = l.filter(a => a.scanned).length;
    for (let loadedMore = 0; loadedMore <= 9; loadedMore++) {
      const target = Math.min(loadedMore, l.length);
      const vieja = l.filter(a => !a.scanned).slice(0, Math.max(0, target - escaneados));
      const nueva = colaAutomatica(artistasBuscados(l, loadedMore), escaneados);
      casos++;
      if (JSON.stringify(nombres(vieja)) === JSON.stringify(nombres(nueva))) iguales++;
    }
  }
  eq(iguales, casos, `las ${casos} combinaciones coinciden con v=258`);
}

console.log(`OK cola-escaneo: ${n} asserts`);
