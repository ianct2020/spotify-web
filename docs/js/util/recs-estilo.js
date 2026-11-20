// Playlists por estilo en Recomendaciones (v=369, tanda 132).
//
// PURO: sin red, sin DOM y sin IndexedDB. Todo lo que toca el mundo llega inyectado (la petición
// a Last.fm, el guardado, el reloj, los top tracks, la resolución en Spotify, la vigencia de la
// ruta), así `tests/recs-estilo.test.mjs` lo corre en Node con artistas inventados y la vista
// (`features/recommendations.js`) le enchufa lo de verdad.
//
// Qué hay acá:
//   · `pedirEtiquetas`: las etiquetas de Last.fm de los recomendados que todavía NO están buscados,
//     de a una, con 1.000 ms como mínimo entre comienzos y SIN reintentos;
//   · `agruparPorEstilo`: los estilos con 2 o más artistas, con la regla de `#generos`;
//   · `planDeLista` / `armarLista`: la lista de un estilo, con su tope de búsquedas;
//   · los textos que enseña la vista.
//
// 🔴 No se escribe ninguna regla dos veces (v=219): qué es un género lo decide `generosDeArtista`
// (`generos-regla.js`), qué está buscado lo decide `yaBuscado`, qué hacer con una respuesta de
// Last.fm lo decide `clasificar` y el ritmo es `INTERVALO_MS` (los tres de `generos-escaneo.js`),
// y el filtro de las etiquetas es `etiquetasDe` (el mismo `filtrarEtiquetasLastfm` de siempre).
// `escanearGeneros` NO se usa: reintenta solo, y aquí no hay ningún reintento automático.

import { generosDeArtista } from './generos-regla.js?v=373';
import { yaBuscado, clasificar, etiquetasDe, INTERVALO_MS } from './generos-escaneo.js?v=373';

// ── Los topes ────────────────────────────────────────────────────────────────
//
// La búsqueda de Spotify (`/search`) tiene su propia cuota y la comparte toda la app: el 18/09/2026
// dio 429 `QUOTA_EXCEEDED` tras unas 700 peticiones (medido UNA vez; no es un límite publicado). Con
// el peor caso de una lista (6 artistas × (15 + 3) = 108 búsquedas) entran unas 6 listas antes de
// chocar. Subir cualquiera de los tres números sube ese peor caso: no se toca sin decirlo.
export const ARTISTAS_POR_ESTILO = 6;
export const TEMAS_MIN = 10;
export const TEMAS_MAX = 15;
export const TEMAS_DEFECTO = 12;
export const BUSQUEDAS_DE_MAS = 3;
// Un estilo de un solo artista es lo mismo que tocar ese artista (ya existe): no se enseña.
export const MIN_ARTISTAS_POR_ESTILO = 2;

// La comparación simple de `universo()` (`mapa-paises.js`) y de `armarGeneros`: la misma en
// cualquier navegador, sin depender del idioma.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ── Las etiquetas ────────────────────────────────────────────────────────────

/** Los que hay que pedir: los que `yaBuscado` no da por buscados, en el orden de `nombres`. */
export function pendientesDeEtiquetas(nombres, registro) {
  return nombres.filter((n) => !yaBuscado(registro(n)));
}

/**
 * Pide a Last.fm las etiquetas de los que faltan. Una petición por vez, 1.000 ms como mínimo entre
 * COMIENZOS, y ningún reintento: lo que falla queda «sin buscar» y se dice.
 *   · `toptags` (aunque traiga 0) y el «no encontrado» (6) se GUARDAN, con el nombre que devolvió
 *     Last.fm (`toptags['@attr'].artist`) para que la regla del autocorrect valga igual que en
 *     `#generos`;
 *   · un 29, un 5xx, un 429, un corte o cualquier temporal NO se guardan nunca (`noContesto`);
 *   · un 10 o un 26 (la key) paran todo (`motivo: 'key'`).
 * Lo que ya llegó se guarda ANTES de mirar si hay que seguir: salir de la ruta o «Parar» no pierden
 * una respuesta que ya está en la mano.
 *
 * @param {object}   o
 * @param {string[]} o.nombres   los recomendados a la vista, en su orden
 * @param {Function} o.registro  `(nombre) => registro | null` (el del almacén)
 * @param {Function} o.pedir     `async (nombre) => ({ status, datos })`; tira si la red falla
 * @param {Function} o.guardar   `async (nombre, tags, artista) => boolean` (false: no se pudo)
 * @param {object}   o.reloj     `{ ahora(): ms, esperar(ms): Promise }`
 * @param {Function} [o.seguir]  `() => boolean`, después de cada `await` (la ruta y «Parar»)
 * @param {Function} [o.onPaso]  `({ hechos, total, nombre, tipo })`, después de cada respuesta
 * @returns {Promise<{ motivo: 'completo'|'parado'|'key'|'no-guarda', codigo?: number, total: number,
 *   pedidas: number, guardados: string[], noContesto: {nombre, status, codigo}[] }>}
 */
export async function pedirEtiquetas({ nombres, registro, pedir, guardar, reloj, seguir = () => true, onPaso = null }) {
  const pendientes = pendientesDeEtiquetas(nombres, registro);
  const out = { motivo: 'completo', total: pendientes.length, pedidas: 0, guardados: [], noContesto: [] };
  let ultimoComienzo = -Infinity;
  for (let i = 0; i < pendientes.length; i++) {
    const nombre = pendientes[i];
    if (!seguir()) return { ...out, motivo: 'parado' };
    const espera = ultimoComienzo + INTERVALO_MS - reloj.ahora();
    if (espera > 0) {
      await reloj.esperar(espera);
      if (!seguir()) return { ...out, motivo: 'parado' };
    }
    ultimoComienzo = reloj.ahora();
    out.pedidas++;
    let status, datos = null;
    try {
      const r = await pedir(nombre);
      status = r.status;
      datos = r.datos ?? null;
    } catch {
      status = 'red';
    }
    const c = clasificar({ status, datos });
    if (c.tipo === 'ok' || c.tipo === 'no-encontrado') {
      const tags = c.tipo === 'ok' ? etiquetasDe(datos) : [];
      const artista = c.tipo === 'ok' ? (datos?.toptags?.['@attr']?.artist ?? null) : undefined;
      const guardado = await guardar(nombre, tags, artista);
      if (guardado === false) return { ...out, motivo: 'no-guarda' };
      out.guardados.push(nombre);
    } else if (c.tipo === 'key') {
      return { ...out, motivo: 'key', codigo: c.codigo };
    } else {
      // `reintentar` y `del-artista`: no es una respuesta sobre el artista. No se guarda.
      out.noContesto.push({ nombre, status, codigo: c.codigo });
    }
    onPaso?.({ hechos: i + 1, total: pendientes.length, nombre, tipo: c.tipo });
  }
  return out;
}

// ── Los estilos ──────────────────────────────────────────────────────────────

/**
 * Agrupa por estilo. El estilo de un artista son sus `generos` canónicos (`generosDeArtista`): puede
 * tener varios y aparece en cada uno. Se enseñan los estilos de 2 o más, ordenados por cuántos
 * artistas tienen y, a igualdad, por nombre; los artistas de cada uno, en el orden de `nombres`.
 *
 * `noContesto` (los que Last.fm no contestó en ESTA pasada) separa, dentro de los «sin buscar», a
 * los que fallaron de los que no se llegaron a pedir (con «Parar»).
 *
 * @returns {{ estilos: {estilo: string, artistas: string[]}[], cuentas: {sinGenero, noTiene,
 *   sinBuscarFallo, sinBuscarResto, solos}, porArtista: Map<string, {generos, motivo}> }}
 */
export function agruparPorEstilo(nombres, registro, noContesto = new Set()) {
  const porEstilo = new Map();
  const porArtista = new Map();
  const cuentas = { sinGenero: 0, noTiene: 0, sinBuscarFallo: 0, sinBuscarResto: 0, solos: 0 };
  for (const n of nombres) {
    const g = generosDeArtista(registro(n), n);
    porArtista.set(n, g);
    if (g.motivo === 'sin-genero') cuentas.sinGenero++;
    else if (g.motivo === 'no-tiene') cuentas.noTiene++;
    else if (g.motivo === 'sin-buscar') {
      if (noContesto.has(n)) cuentas.sinBuscarFallo++;
      else cuentas.sinBuscarResto++;
    }
    for (const estilo of g.generos) {
      if (!porEstilo.has(estilo)) porEstilo.set(estilo, []);
      porEstilo.get(estilo).push(n);
    }
  }
  const estilos = [...porEstilo]
    .map(([estilo, artistas]) => ({ estilo, artistas }))
    .filter((e) => e.artistas.length >= MIN_ARTISTAS_POR_ESTILO)
    .sort((a, b) => (b.artistas.length - a.artistas.length) || cmp(a.estilo, b.estilo));
  // Los que tienen estilo pero ninguno compartido: también se cuentan, para que nadie desaparezca
  // sin decir por qué.
  const enAlguno = new Set(estilos.flatMap((e) => e.artistas));
  cuentas.solos = nombres.filter((n) => porArtista.get(n).generos.length > 0 && !enAlguno.has(n)).length;
  return { estilos, cuentas, porArtista };
}

/** La línea de lo que no entró, solo con las partes que no son cero ('' si todo entró). */
export function textoSinEstilo(c) {
  const partes = [];
  if (c.sinGenero) partes.push(`${c.sinGenero} sin etiquetas de género`);
  if (c.noTiene) partes.push(`${c.noTiene} que Last.fm no tiene`);
  if (c.sinBuscarFallo) partes.push(`${c.sinBuscarFallo} sin buscar (Last.fm no contestó)`);
  if (c.sinBuscarResto) partes.push(`${c.sinBuscarResto} sin buscar (paraste antes de llegar)`);
  const n = c.sinGenero + c.noTiene + c.sinBuscarFallo + c.sinBuscarResto;
  const frases = [];
  if (n) frases.push(`${n} sin estilo: ${partes.join(', ')}.`);
  if (c.solos) frases.push(`${c.solos} con un estilo que no comparte ningún otro recomendado.`);
  return frases.join(' ');
}

export const TEXTO_SIN_ESTILOS = 'Tus recomendados no comparten ningún estilo.';

// ── La lista de un estilo ────────────────────────────────────────────────────

/** Los temas por artista, entre 10 y 15 (lo que no sea un número, el defecto). */
export function normalizarTemas(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return TEMAS_DEFECTO;
  return Math.min(TEMAS_MAX, Math.max(TEMAS_MIN, v));
}

/** El plan: los primeros 6 artistas del estilo y el tope de búsquedas (por artista y en total). */
export function planDeLista(artistas, temas) {
  const t = normalizarTemas(temas);
  const elegidos = artistas.slice(0, ARTISTAS_POR_ESTILO);
  const topePorArtista = t + BUSQUEDAS_DE_MAS;
  return { artistas: elegidos, temas: t, topePorArtista, topeTotal: elegidos.length * topePorArtista };
}

export const textoCoste = (plan) => `Hasta ${plan.topeTotal} búsquedas en Spotify.`;
export const TITULO_COSTE = 'La búsqueda de Spotify tiene su propia cuota y la comparte toda la aplicación: '
  + 'se midió un 429 después de unas 700 búsquedas (una sola vez, el 18/09/2026; no es un límite publicado). '
  + `Por eso cada lista se queda en ${ARTISTAS_POR_ESTILO} artistas y en «temas por artista + ${BUSQUEDAS_DE_MAS}» búsquedas por artista.`;

/**
 * Arma la lista. Por artista: sus top tracks de Last.fm (1 llamada) y se resuelven EN ORDEN hasta
 * juntar `temas` temas nuevos (encontrados y que no estén en tus me gusta), o agotar los candidatos,
 * o gastar `temas + 3` búsquedas en ese artista.
 *   · Si `resolver` dice `error` (Spotify no contestó, no «sin match»): se para TODA la lista ahí,
 *     ni una búsqueda más, y se queda lo encontrado (`corte.tipo = 'error'`).
 *   · Si `seguir()` da false (salir de la ruta o «Parar»): igual, `corte.tipo = 'parado'`.
 *   · Si `topTracks` de un artista tira: ese artista queda con `lastfmFallo` y se sigue (no gasta
 *     cuota de Spotify).
 *
 * @param {object}   o
 * @param {object}   o.plan        `planDeLista(...)`
 * @param {Function} o.topTracks   `async (nombre) => [{ name, artist }]`
 * @param {Function} o.resolver    `async (tema) => { estado: 'encontrado', fila } | { estado: 'sin-match' } | { estado: 'error', error }`
 * @param {Function} o.enMeGusta   `(uri) => boolean`
 * @param {Function} [o.seguir]
 * @param {Function} [o.esperar]   `async (ms)`: la pausa entre búsquedas
 * @param {number}   [o.pausaMs]
 * @param {Function} [o.onPaso]    `({ busquedas, artista })`, antes de cada búsqueda
 */
export async function armarLista({ plan, topTracks, resolver, enMeGusta, seguir = () => true, esperar = async () => {}, pausaMs = 0, onPaso = null }) {
  const artistas = [];
  let busquedas = 0;
  let corte = null;
  const vistas = new Set();
  let i = 0;
  fuera: for (; i < plan.artistas.length; i++) {
    const nombre = plan.artistas[i];
    if (!seguir()) { corte = { tipo: 'parado' }; break; }
    const a = { nombre, temas: [], sinMatch: 0, yaGusta: 0, repetidos: 0, candidatos: 0, busquedas: 0, lastfmFallo: null, cortado: false, agotados: false, tope: false };
    artistas.push(a);
    let candidatos;
    try {
      candidatos = await topTracks(nombre);
    } catch (e) {
      a.lastfmFallo = e;
      continue;
    }
    if (!seguir()) { a.cortado = true; corte = { tipo: 'parado' }; break; }
    a.candidatos = candidatos.length;
    for (const t of candidatos) {
      if (a.temas.length >= plan.temas || a.busquedas >= plan.topePorArtista) break;
      if (busquedas > 0) {
        await esperar(pausaMs);
        if (!seguir()) { a.cortado = true; corte = { tipo: 'parado' }; break fuera; }
      }
      a.busquedas++;
      busquedas++;
      onPaso?.({ busquedas, artista: nombre });
      const r = await resolver(t);
      if (r.estado === 'error') { a.cortado = true; corte = { tipo: 'error', error: r.error }; break fuera; }
      if (r.estado === 'sin-match') a.sinMatch++;
      else if (enMeGusta(r.fila.uri)) a.yaGusta++;
      else if (vistas.has(r.fila.uri)) a.repetidos++;
      else { vistas.add(r.fila.uri); a.temas.push(r.fila); }
      if (!seguir()) { a.cortado = a.temas.length < plan.temas; corte = { tipo: 'parado' }; break fuera; }
    }
    if (a.temas.length < plan.temas) {
      if (a.busquedas >= a.candidatos) a.agotados = true;
      else a.tope = true;
    }
  }
  // Los que ni empezaron (el que se cortó a mitad tiene su cabecera, que lo dice).
  const empezados = new Set(artistas.map((a) => a.nombre));
  const sinBuscar = plan.artistas.filter((n) => !empezados.has(n));
  if (corte) corte.busquedas = busquedas;
  return { artistas, busquedas, corte, sinBuscar };
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** La línea de la cabecera de un artista: «8 de 12: 3 sin match en Spotify, 2 ya en tus me gusta.» */
export function textoCabecera(a, plan) {
  if (a.lastfmFallo) return 'Last.fm no contestó: este artista no tiene temas en la lista.';
  const partes = [];
  if (a.sinMatch) partes.push(`${a.sinMatch} sin match en Spotify`);
  if (a.yaGusta) partes.push(`${a.yaGusta} ya en tus me gusta`);
  if (a.repetidos) partes.push(plural(a.repetidos, 'repetido', 'repetidos'));
  if (a.temas.length < plan.temas) {
    if (a.cortado) partes.push('la búsqueda se cortó aquí');
    else if (a.agotados) partes.push(a.candidatos ? `Last.fm solo tiene ${plural(a.candidatos, 'tema', 'temas')}` : 'Last.fm no tiene temas suyos');
    else if (a.tope) partes.push(`se llegó al tope de ${plan.topePorArtista} búsquedas`);
  }
  return `${a.temas.length} de ${plan.temas}${partes.length ? `: ${partes.join(', ')}` : ''}.`;
}

/** El aviso de arriba cuando la lista se cortó. */
export function textoCorte(corte) {
  const n = plural(corte.busquedas, 'búsqueda', 'búsquedas');
  return corte.tipo === 'error'
    ? `Spotify dejó de contestar después de ${n}: la lista está incompleta.`
    : `Paraste después de ${n}: la lista está incompleta.`;
}

export const textoSinBuscar = (nombres) => `Sin buscar: ${nombres.join(', ')}.`;

export const nombreSugerido = (estilo) => `Recomendados: ${estilo}`;
export const descripcionPlaylist = (estilo) => `Recomendado desde tus scrobbles · ${estilo}`;
