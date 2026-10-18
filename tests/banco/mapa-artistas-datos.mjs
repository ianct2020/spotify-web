// Los datos INVENTADOS del banco `mapa-artistas` (v=315, tanda 64). El repo es público: nada de
// esto es de nadie. Un historial de 2.302 artistas («Artista inventado 0001»…) y un mapa con la
// forma de `history-artist-similares.json` y la DENSIDAD que midió la tanda 63 (grado medio ~52
// dentro del historial): posiciones en doce manchas y pares sobre todo dentro de cada mancha.
// Determinista (mulberry32 con semilla fija): cada corrida del banco ve el mismo grafo.

export const N = 2302;
const SEMILLA = 640064;

function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nombreDe = (i) => `Artista inventado ${String(i + 1).padStart(4, '0')}`;
// Los aislados: uno de cada 250 (nueve). Sin ningún par: sirven para la línea de «no tienen ningún parecido».
export const esAislado = (i) => i % 250 === 249;

/** El historial: minutos estrictamente decrecientes (así el orden de `universo()` es el del índice). */
export function historial() {
  const totals = {};
  for (let i = 0; i < N; i++) {
    const min = Math.round((10.5 + 3000 * Math.exp(-i / 260) + (N - i) * 0.01) * 10) / 10;
    totals[nombreDe(i)] = [Math.round(min / 3), min, [], 2020, 2025, '2020-01-01', null, null];
  }
  return { version: 3, artists: {}, totals };
}

/** El mapa: `{ version, fuente, fecha, limit, nombres, pos, aristas }`, como el horneado. */
export function grafo() {
  const r = prng(SEMILLA);
  const MANCHAS = 12;
  const mancha = Array.from({ length: N }, () => Math.floor(r() * MANCHAS));
  const pos = [];
  for (let i = 0; i < N; i++) {
    const ang = (mancha[i] / MANCHAS) * Math.PI * 2;
    const cx = Math.cos(ang) * 700, cy = Math.sin(ang) * 700;
    const rr = Math.sqrt(r()) * 260, aa = r() * Math.PI * 2;
    pos.push(Math.round((cx + Math.cos(aa) * rr) * 10) / 10, Math.round((cy + Math.sin(aa) * rr) * 10) / 10);
  }
  const porMancha = Array.from({ length: MANCHAS }, () => []);
  for (let i = 0; i < N; i++) if (!esAislado(i)) porMancha[mancha[i]].push(i);
  const libres = [...Array(N).keys()].filter((i) => !esAislado(i));
  const pares = new Map();
  for (let i = 0; i < N; i++) {
    if (esAislado(i)) continue;
    for (let k = 0; k < 29; k++) {
      const lista = r() < 0.8 ? porMancha[mancha[i]] : libres;
      const j = lista[Math.floor(r() * lista.length)];
      if (j === i) continue;
      const a = Math.min(i, j), b = Math.max(i, j), id = a * N + b;
      if (!pares.has(id)) pares.set(id, [a, b, 1 + Math.floor(r() * 1000), r() < 0.5 ? 1 : 0]);
    }
  }
  const aristas = [...pares.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]).flat();
  return { version: 1, fuente: 'banco (INVENTADO)', fecha: '2026-10-18', limit: 250, nombres: Array.from({ length: N }, (_, i) => nombreDe(i)), pos, aristas };
}

/** Los vecinos de `i`, contados SIN `util/mapa-artistas.js`: por match de mayor a menor y, a igualdad, por índice. */
export function vecinosEsperados(g, i) {
  const fuera = [];
  for (let k = 0; k < g.aristas.length; k += 4) {
    const [a, b, m] = g.aristas.slice(k, k + 3);
    if (a === i) fuera.push([b, m]);
    else if (b === i) fuera.push([a, m]);
  }
  return fuera.sort((x, y) => y[1] - x[1] || x[0] - y[0]).map((x) => x[0]);
}
