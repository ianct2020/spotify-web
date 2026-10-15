// El mundo de `#mapa` (v=305, tanda 53): de qué tono va cada país.
//
// Módulo PURO: sin DOM, sin red, sin IndexedDB. Recibe lo que arma `armarMapa()`
// (`util/mapa-paises.js`) y la lista de formas del mundo (`util/mundo-110m.js`,
// generado) y devuelve el tono de cada país, qué países con minutos no tienen
// forma en el dibujo, el texto de la línea de detalle y la leyenda. La vista
// (`features/mapa.js`) arma el SVG una vez y le aplica esto.
//
// 🔴 Lo que se pinta es EXACTAMENTE lo que dice la lista de países, y nada más:
// `mapa.paises`, con sus minutos. Lo «sin confirmar» y lo «sin país» no se
// pintan en ningún país, ni se reparten (la regla de `mapa-paises.js`): este
// archivo no mira `mapa.sinPais` ni `mapa.filas`. Un país que solo tiene
// artistas sin confirmar va «sin datos».
//
// 🔴 Los cortes son FIJOS (no cuantiles ni relativos al máximo) y sobre TODO el
// historial, el mismo % de la lista: así la leyenda se lee en palabras («10 % o
// más de tus minutos») y un país no cambia de color porque otro creció. La
// cuenta es con enteros (décimas de minuto × 1000 contra el total × el corte en
// décimas de punto): con flotantes, «el 3 % justo» puede caer de cualquier lado.

// Los cortes, en % de todo tu historial: tono 5 desde el 10 %, 4 desde el 3 %, 3
// desde el 1 %, 2 desde el 0,3 % y 1 por encima de 0.
export const CORTES_PCT = [10, 3, 1, 0.3];
const CORTES_DECIMAS_DE_PUNTO = CORTES_PCT.map((c) => Math.round(c * 10));   // 100, 30, 10, 3

/** El tono (0 = sin datos, 1-5) de `decimas` minutos sobre un total de `total` décimas. */
export function tonoDe(decimas, total) {
  if (!(decimas > 0) || !(total > 0)) return 0;
  const parte = decimas * 1000;   // décimas de punto: parte/total ≥ c/1000 ⇔ decimas·1000 ≥ total·c
  for (let i = 0; i < CORTES_DECIMAS_DE_PUNTO.length; i++) {
    if (parte >= total * CORTES_DECIMAS_DE_PUNTO[i]) return 5 - i;
  }
  return 1;
}

// Números con `es-ES` explícito, como la lista (`features/mapa.js`): sin el
// locale se usa el del navegador y salen dos formatos en la misma pantalla.
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;

/**
 * El mundo, con la caché de hoy.
 *
 * @param {{ total: number, paises: Array<{codigo, nombre, decimas, artistas}> }} mapa  lo de `armarMapa()`
 * @param {Array<{iso: string|null, d: string}>} formas  `FORMAS` de `mundo-110m.js`
 * @param {(codigo: string) => string} [nombrePais]  el nombre (la vista pasa `Intl.DisplayNames`)
 * @returns {{ tonos: Map<string, number>, porCodigo: Map, pintados: number,
 *             paisesConMinutos: number, sinForma: Array, total: number }}
 */
export function armarMundo(mapa, formas, nombrePais = (c) => c) {
  const total = mapa?.total || 0;
  const porCodigo = new Map((mapa?.paises || []).map((p) => [p.codigo, p]));
  const tonos = new Map();
  let pintados = 0;
  for (const f of formas || []) {
    if (!f.iso) continue;   // las formas sin código (-99) no tienen tono: no se pueden elegir
    const p = porCodigo.get(f.iso);
    const t = p ? tonoDe(p.decimas, total) : 0;
    tonos.set(f.iso, t);
    if (t > 0) pintados++;
  }
  // Los países con minutos que no tienen forma a esta escala (Malta, Singapur…).
  // Siguen en la lista de países: esto es solo lo que el DIBUJO no puede enseñar.
  const sinForma = (mapa?.paises || [])
    .filter((p) => !tonos.has(p.codigo))
    .map((p) => ({ codigo: p.codigo, nombre: p.nombre || nombrePais(p.codigo), decimas: p.decimas }));
  return { tonos, porCodigo, pintados, paisesConMinutos: porCodigo.size, sinForma, total };
}

/** «No se ven en el mapa: Malta, Singapur», o '' si todos tienen forma. */
export function textoNoSeVen(mundo) {
  if (!mundo?.sinForma?.length) return '';
  return `No se ven en el mapa: ${mundo.sinForma.map((p) => p.nombre).join(', ')}`;
}

/** El `aria-label` del SVG. La versión accesible del mapa es la lista. */
export function etiquetaMapa(mundo) {
  return `Mapa de tus países: ${plural(mundo?.paisesConMinutos || 0, 'país', 'países')} con minutos`;
}

/** La línea de detalle de un país (al pasar el ratón o tocarlo). */
export function textoDetalle(iso, mundo, nombrePais = (c) => c) {
  const p = mundo?.porCodigo?.get(iso);
  if (!p) return `${nombrePais(iso)} · sin datos`;
  const pct = mundo.total ? (p.decimas / mundo.total) * 100 : 0;
  return `${p.nombre || nombrePais(iso)} · ${fmt(Math.round(p.decimas / 10))} min · ${fmt(pct, 1)} % de tus minutos · ${plural(p.artistas?.length || 0, 'artista', 'artistas')}`;
}

/** La leyenda: «sin datos» y los cinco tonos, del más flojo al más fuerte. */
export function leyenda() {
  return {
    titulo: 'Qué parte de tus minutos es de artistas de cada país',
    tonos: [
      { tono: 0, texto: 'Sin datos' },
      { tono: 1, texto: 'Menos del 0,3 %' },
      { tono: 2, texto: 'Del 0,3 al 1 %' },
      { tono: 3, texto: 'Del 1 al 3 %' },
      { tono: 4, texto: 'Del 3 al 10 %' },
      { tono: 5, texto: '10 % o más' },
    ],
    frase: 'Los minutos sin país no se pintan.',
  };
}
