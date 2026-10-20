// Los datos INVENTADOS del banco `mapa-artistas` (v=315, tanda 64). El repo es público: nada de
// esto es de nadie. Un historial de 2.302 artistas («Artista inventado 0001»…) y un mapa con la
// forma de `history-artist-similares.json` y la DENSIDAD que midió la tanda 63 (grado medio ~52
// dentro del historial): posiciones en doce manchas y pares sobre todo dentro de cada mancha.
// Determinista (mulberry32 con semilla fija): cada corrida del banco ve el mismo grafo.
//
// v=316 (tanda 65): como el horneado nuevo, los sueltos van en una FRANJA debajo del grafo, en una
// grilla de 48 (la de `colocarSueltos` de `scripts/hornear-similares.mjs`, escrita acá de nuevo porque
// el script es de Node): dos de los nueve aislados pasan a ser una pareja (un componente chico de dos,
// con un solo par entre ellos), y quedan siete aislados. El resto del grafo, el mismo de la v=315.
//
// v=319 (tanda 67): una ESTRELLA para la puerta I. Con el grafo de manchas, encuadrar a cualquiera acercaba ~1,03
// veces: sus 30 primeros parecidos estaban desparramados por la mancha. Ahora el artista `ESTRELLA` tiene 30 parecidos
// APRETADOS alrededor (`APRETADOS`, a entre 6 y 20 unidades), con `match` 1.000, así que son sus 30 primeros; los
// pares suyos que ya tenían 1.000 con otro bajan a 999 (si no, un vecino lejano de índice menor se colaría entre los
// 30). Siguen en su mancha y dentro del componente grande: los pares de siempre no se tocan.

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
// Dos de ellos (v=316) son una pareja: solo se parecen entre sí. Los aislados de verdad quedan siete.
export const PAREJA = [1999, 2249];
export const esSuelto = esAislado;
// v=319: la estrella y sus 30 (ninguno es aislado: 1249 es el primero de esa franja que lo sería).
export const ESTRELLA = 1200;
export const APRETADOS = Array.from({ length: 30 }, (_, k) => ESTRELLA + 1 + k);

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
  pares.set(PAREJA[0] * N + PAREJA[1], [PAREJA[0], PAREJA[1], 500, 1]);
  // La estrella (v=319): sus 30 alrededor, en espiral, y con `match` 1.000; ningún otro par suyo empata con ellos.
  for (const [id, p] of pares) if ((p[0] === ESTRELLA || p[1] === ESTRELLA) && p[2] === 1000) pares.set(id, [p[0], p[1], 999, p[3]]);
  const ex = pos[2 * ESTRELLA], ey = pos[2 * ESTRELLA + 1];
  APRETADOS.forEach((j, k) => {
    const d = 6 + (14 * k) / 29, ang = k * 2.399963;
    pos[2 * j] = Math.round((ex + Math.cos(ang) * d) * 10) / 10;
    pos[2 * j + 1] = Math.round((ey + Math.sin(ang) * d) * 10) / 10;
    pares.set(ESTRELLA * N + j, [ESTRELLA, j, 1000, 1]);
  });
  const aristas = [...pares.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]).flat();
  // La franja: la caja del grafo (contando radios), y debajo la pareja y después los aislados, en orden.
  const totals = historial().totals, max = totals[nombreDe(0)][1];
  const radio = (i) => 2 + 18 * Math.sqrt(totals[nombreDe(i)][1] / max);
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    if (esSuelto(i)) continue;
    minX = Math.min(minX, pos[2 * i] - radio(i)); maxX = Math.max(maxX, pos[2 * i] + radio(i)); maxY = Math.max(maxY, pos[2 * i + 1] + radio(i));
  }
  const columnas = Math.max(1, Math.floor((maxX - minX) / 48));
  const sueltos = [...PAREJA, ...[...Array(N).keys()].filter((i) => esAislado(i) && !PAREJA.includes(i))];
  sueltos.forEach((i, n) => {
    pos[2 * i] = Math.round((minX + 24 + (n % columnas) * 48) * 10) / 10;
    pos[2 * i + 1] = Math.round((maxY + 96 + Math.floor(n / columnas) * 48) * 10) / 10;
  });
  return { version: 2, fuente: 'banco (INVENTADO)', fecha: '2026-10-18', limit: 250, nombres: Array.from({ length: N }, (_, i) => nombreDe(i)), pos, aristas };
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
