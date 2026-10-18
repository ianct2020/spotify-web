// Hornea el mapa de artistas (tanda 64): los parecidos de Last.fm entre los artistas del historial
// de Ian y dónde cae cada uno en el plano, calculado UNA vez acá, en Node. El navegador no corre
// ninguna simulación: lee las posiciones de `src/data/history-artist-similares.json`.
//
//   node scripts/hornear-similares.mjs escanear <archivo de avance.jsonl>
//   node scripts/hornear-similares.mjs hornear  <archivo de avance.jsonl> <d3.min.js>
//
// El molde es el de `bake-covers.py`: un dato horneado aparte, con su script commiteado, que
// nadie corre al cargar la app. Lo que mide y decide salió de la tanda 63
// (`fonoteca-migracion/mapa-artistas/`): con `limit=250` la mediana de parecidos que también
// están en el historial es 55; con el `limit=50` que usa la app, la media baja de 52 a 15.
//
// 🔴 LA KEY. Se lee del fuente (`DEFAULT_API_KEY` de `src/js/api/lastfm.js`) y no se escribe en
// ningún lado: cada línea del avance se revisa antes de escribirse y, si la contiene, el script
// tira en vez de escribirla.
//
// 🔴 EL AVANCE NO VA A ESTE REPO. Lleva las respuestas crudas de Last.fm, con los similares que
// NO están en el historial: vive en `fonoteca-migracion` (privado). Lo que sí se publica es el
// JSON horneado: los nombres del universo (ya públicos en `history-artist-tracks.json`), las
// posiciones y los pares con su `match`. Sin minutos, sin plays: eso lo calcula el navegador.
//
// ESCANEAR. Una línea por petición, escrita apenas termina (si se corta, lo hecho queda).
//   · El universo es `universo()` de `util/mapa-paises.js`, importado, y se pide en su orden (de
//     más minutos a menos): un corte deja hechos los que más pesan.
//   · `artist.getsimilar`, `limit=250`, `autocorrect=1`, `format=json`, sin ninguna cabecera
//     propia, de a una y 1.000 ms como mínimo entre comienzos (el ritmo de `#generos`).
//   · Definitivo (lo mismo que `clasificar` de `util/generos-escaneo.js`): un 200 con
//     `similarartists` (aunque traiga 0) y el error 6 (no encontrado, con HTTP 200). Un 29, un 5xx,
//     un 429, un corte de red (o 30 s sin respuesta), los temporales 8/11/16 o un 200 sin
//     `similarartists` se reintentan con el MISMO artista tras `esperaTrasFallo` del mapa (10, 20,
//     40, 80 y 80 fijos); 8 seguidos paran el escaneo sin descartar nada. Un 10 o un 26 (la key)
//     paran todo. Cualquier otro código es del artista: se anota y se sigue.
//   · Retomable: al arrancar se lee el avance y no se le pide a nadie que ya tenga respuesta
//     definitiva. El tope (`TOPE`) es de la tanda entera y cuenta TODAS las líneas del avance,
//     también las de otros métodos que se hayan anotado ahí.
//
// HORNEAR. Sin red.
//   · «Está en tu historial» es la regla de la 63: igualdad de `normalizarNombre` (importado de
//     `util/mb-pais.js`) entre el similar y un nombre del universo, sin el propio artista. Si dos
//     nombres del universo normalizan igual, gana el primero en el orden de `universo()`.
//   · Si el autocorrect devolvió OTRO nombre (según `normalizarNombre`), ese artista no aporta
//     aristas salientes (la prudencia de `#generos`: un autocorrect equivocado mete parecidos de
//     otro y no se ve). Sí recibe las de los demás.
//   · Sin dirección: el par {a, b} existe si a apunta a b o b a a; su peso es el MAYOR `match` de
//     las dos direcciones, en entero de 0 a 1.000, y `mutua` dice si están las dos. Ningún corte.
//   · El layout: d3 7.9.0 (cargado con `vm`, verificado por sha256; no está en `package.json`),
//     las fuerzas de la 63 sin tocar: `forceLink`, `forceManyBody`, `forceCenter` y
//     `forceCollide(r)` con r = 2 + 18·√(minutos / máximo), todo lo demás por defecto, 300 ticks.
//   · Solo se hornea con al menos el 95 % del universo con respuesta definitiva. Tope de 3 MB: si
//     lo pasa, cada artista conserva sus 40 aristas de mayor `match` (un par queda si alguno de
//     los dos lo conserva).

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { universo } from '../src/js/util/mapa-paises.js';
import { normalizarNombre } from '../src/js/util/mb-pais.js';
import { esperaTrasFallo, FALLOS_PARA_PAUSAR } from '../src/js/util/mapa-escaneo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'src/data/history-artist-similares.json');

export const LIMIT = 250;
export const INTERVALO_MS = 1000;
export const TIMEOUT_MS = 30000;
export const TOPE = 2460;
export const MINIMO_PARA_HORNEAR = 0.95;
export const TOPE_BYTES = 3 * 1024 * 1024;
export const ARISTAS_POR_ARTISTA_SI_SOBRA = 40;
export const TICKS = 300;
const D3_SHA256 = 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539';
const METODO = 'artist.getsimilar';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function cargarUniverso() {
  const hat = JSON.parse(readFileSync(join(RAIZ, 'src/data/history-artist-tracks.json'), 'utf8'));
  const u = universo(hat.totals, hat.artists);
  return { u, huella: sha256(u.map((x) => x.nombre).join('\n')) };
}

function leerKey() {
  const k = readFileSync(join(RAIZ, 'src/js/api/lastfm.js'), 'utf8').match(/const DEFAULT_API_KEY = '([0-9a-f]+)'/)?.[1];
  if (!k) throw new Error('No encontré la key en el fuente.');
  return k;
}

export function leerAvance(archivo) {
  if (!existsSync(archivo)) return [];
  return readFileSync(archivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Qué hacer con una respuesta. `clasificar` de `util/generos-escaneo.js` mira `toptags`; acá es
// `similarartists`, con las mismas salidas.
const CODIGOS_KEY = [10, 26];
const CODIGOS_REINTENTAR = [8, 11, 16, 29];
export function clasificar({ status, datos }) {
  const codigo = datos && typeof datos === 'object' && Number.isFinite(datos.error) ? datos.error : null;
  if (codigo !== null) {
    if (codigo === 6) return 'definitiva';
    if (CODIGOS_KEY.includes(codigo)) return 'key';
    if (CODIGOS_REINTENTAR.includes(codigo)) return 'reintentar';
    return 'del-artista';
  }
  if (status === 'red' || status === 429 || (typeof status === 'number' && status >= 500)) return 'reintentar';
  if (status === 200) return datos && typeof datos === 'object' && datos.similarartists ? 'definitiva' : 'reintentar';
  return 'del-artista';
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function escanear(archivo) {
  const key = leerKey();
  const { u, huella } = cargarUniverso();
  const previas = leerAvance(archivo);
  const hechos = new Set(previas.filter((p) => p.metodo === METODO && p.clase === 'definitiva').map((p) => p.indice));
  let gastadas = previas.length;
  console.log(JSON.stringify({ universo: u.length, huella, yaDefinitivos: hechos.size, peticionesPrevias: gastadas, tope: TOPE }));

  const escribir = (linea) => {
    const texto = JSON.stringify(linea);
    if (texto.includes(key)) throw new Error('La línea contiene la key: no se escribe.');
    appendFileSync(archivo, texto + '\n');
  };

  let ultimo = -Infinity, fallosSeguidos = 0, motivo = 'completo';
  const t0 = Date.now();
  afuera:
  for (let indice = 0; indice < u.length; indice++) {
    if (hechos.has(indice)) continue;
    const { nombre, minutos } = u[indice];
    for (let intento = 0; ; intento++) {
      if (gastadas >= TOPE) { motivo = 'tope'; break afuera; }
      // Se vuelve a mirar el reloj después de dormir: nunca menos de 1 s entre comienzos.
      while (Date.now() - ultimo < INTERVALO_MS) await dormir(INTERVALO_MS - (Date.now() - ultimo));
      const qs = new URLSearchParams({ method: METODO, artist: nombre, autocorrect: '1', limit: String(LIMIT), api_key: key, format: 'json' });
      const p = { n: gastadas + 1, metodo: METODO, indice, pedido: nombre, minutos, limit: LIMIT, reintento: intento, comienzo: new Date().toISOString(), status: null, errorLastfm: null, latenciaMs: null, acao: null, devuelto: null, similarartists: false, similares: [], red: null, clase: null };
      ultimo = Date.now();
      const t = performance.now();
      let datos = null;
      try {
        const res = await fetch('https://ws.audioscrobbler.com/2.0/?' + qs, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
        p.status = res.status;
        p.acao = res.headers.get('access-control-allow-origin');
        const cuerpo = await res.text();
        try { datos = JSON.parse(cuerpo); } catch { p.red = 'Cuerpo no JSON'; }
      } catch (e) {
        p.status = 'red';
        p.red = `${e.name}: ${String(e.message).split(key).join('[KEY OMITIDA]')}`;
      }
      p.latenciaMs = Math.round((performance.now() - t) * 10) / 10;
      p.errorLastfm = datos?.error ?? null;
      p.similarartists = !!datos?.similarartists;
      p.devuelto = datos?.similarartists?.['@attr']?.artist ?? null;
      const lista = datos?.similarartists?.artist;
      p.similares = (Array.isArray(lista) ? lista : lista ? [lista] : []).map(({ name, match, mbid }) => ({ name, match, mbid }));
      p.clase = clasificar({ status: p.status, datos });
      gastadas++;
      escribir(p);
      console.log(JSON.stringify({ n: p.n, indice, status: p.status, error: p.errorLastfm, clase: p.clase, similares: p.similares.length, ms: Math.round(p.latenciaMs) }));
      if (p.clase === 'key') { motivo = `key (código ${p.errorLastfm})`; break afuera; }
      if (p.clase === 'reintentar') {
        fallosSeguidos++;
        if (fallosSeguidos >= FALLOS_PARA_PAUSAR) { motivo = `${FALLOS_PARA_PAUSAR} fallos seguidos`; break afuera; }
        await dormir(esperaTrasFallo(fallosSeguidos));
        continue;
      }
      fallosSeguidos = 0;
      break;   // definitiva o del artista: se sigue con el próximo
    }
  }
  const todas = leerAvance(archivo);
  const definitivos = new Set(todas.filter((p) => p.metodo === METODO && p.clase === 'definitiva').map((p) => p.indice)).size;
  console.log(JSON.stringify({ motivo, peticionesTotales: todas.length, tope: TOPE, definitivos, universo: u.length, segundos: Math.round((Date.now() - t0) / 1000) }));
}

// ── Hornear ──────────────────────────────────────────────────────────────────────────────────

/** La respuesta definitiva de cada índice del universo (la última, si hubiera dos). */
export function definitivas(avance, u) {
  const m = new Map();
  for (const p of avance) {
    if (p.metodo !== METODO || p.clase !== 'definitiva') continue;
    if (u[p.indice]?.nombre !== p.pedido) throw new Error(`El índice ${p.indice} no es «${p.pedido}»: el universo cambió desde el escaneo.`);
    m.set(p.indice, p);
  }
  return m;
}

/**
 * Las aristas sin dirección: `Map` de `i * N + j` (i < j) a `{ i, j, match, ab, ba }`.
 * `autocorregidos` son los índices cuyo nombre devuelto no es el pedido: no aportan salientes.
 */
export function armarAristas(u, resp) {
  const N = u.length;
  const indicePorClave = new Map();
  u.forEach((a, i) => { const k = normalizarNombre(a.nombre); if (!indicePorClave.has(k)) indicePorClave.set(k, i); });
  const pares = new Map(), autocorregidos = [];
  for (const [a, p] of resp) {
    const propio = normalizarNombre(p.pedido);
    if (p.devuelto != null && normalizarNombre(p.devuelto) !== propio) { autocorregidos.push(a); continue; }
    for (const s of p.similares) {
      const k = normalizarNombre(s.name);
      if (k === propio) continue;
      const b = indicePorClave.get(k);
      if (b === undefined || b === a) continue;
      const match = Math.round(Math.min(1, Math.max(0, Number(s.match) || 0)) * 1000);
      const i = Math.min(a, b), j = Math.max(a, b), id = i * N + j;
      let e = pares.get(id);
      if (!e) pares.set(id, e = { i, j, match: 0, ab: false, ba: false });
      e.match = Math.max(e.match, match);
      if (a === i) e.ab = true; else e.ba = true;
    }
  }
  return { pares, autocorregidos };
}

/** El recorte del tope de tamaño: cada artista conserva sus `k` aristas de mayor `match`. */
export function recortar(lista, N, k) {
  const porNodo = Array.from({ length: N }, () => []);
  lista.forEach((e, n) => { porNodo[e.i].push(n); porNodo[e.j].push(n); });
  const queda = new Set();
  for (const l of porNodo) l.sort((x, y) => lista[y].match - lista[x].match || x - y).slice(0, k).forEach((n) => queda.add(n));
  return lista.filter((_, n) => queda.has(n));
}

export function cargarD3(ruta) {
  const fuente = readFileSync(ruta, 'utf8');
  if (sha256(fuente) !== D3_SHA256) throw new Error(`d3.min.js no es el esperado (sha256 ${sha256(fuente)}).`);
  const ctx = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, performance, console });
  vm.runInContext(fuente, ctx, { filename: 'd3.min.js' });
  return ctx.d3;
}

/** Las posiciones, a 1 decimal, en el orden del universo: `[x0, y0, x1, y1, …]`. */
export function acomodar(d3, u, lista) {
  const max = u[0].minutos;
  const nodos = u.map((a) => ({ r: 2 + 18 * Math.sqrt(a.minutos / max) }));
  const links = lista.map((e) => ({ source: e.i, target: e.j }));
  // d3 usa por defecto `randomLcg(1)`: las mismas entradas dan las mismas posiciones.
  const sim = d3.forceSimulation(nodos)
    .force('link', d3.forceLink(links))
    .force('charge', d3.forceManyBody())
    .force('center', d3.forceCenter())
    .force('collide', d3.forceCollide((d) => d.r))
    .stop();
  for (let t = 0; t < TICKS; t++) sim.tick();
  const r1 = (x) => { const v = Math.round(x * 10) / 10; return v === 0 ? 0 : v; };
  return nodos.flatMap((n) => [r1(n.x), r1(n.y)]);
}

function hornear(archivo, rutaD3) {
  if (!rutaD3) throw new Error('Falta la ruta de d3.min.js.');
  const { u, huella } = cargarUniverso();
  const avance = leerAvance(archivo);
  const resp = definitivas(avance, u);
  const informe = { universo: u.length, huella, definitivas: resp.size, minimo: Math.ceil(u.length * MINIMO_PARA_HORNEAR) };
  if (resp.size < informe.minimo) {
    console.log(JSON.stringify({ ...informe, horneado: false, motivo: 'menos del 95 % con respuesta definitiva' }));
    process.exitCode = 3;
    return;
  }
  const { pares, autocorregidos } = armarAristas(u, resp);
  let lista = [...pares.values()].sort((a, b) => a.i - b.i || a.j - b.j);
  const d3 = cargarD3(rutaD3);
  const armar = (l, pos) => JSON.stringify({
    version: 1, fuente: 'Last.fm artist.getSimilar', fecha: new Date().toISOString().slice(0, 10), limit: LIMIT,
    nombres: u.map((a) => a.nombre), pos,
    aristas: l.flatMap((e) => [e.i, e.j, e.match, e.ab && e.ba ? 1 : 0]),
  });
  const t0 = performance.now();
  let pos = acomodar(d3, u, lista);
  informe.layoutMs = Math.round(performance.now() - t0);
  informe.huellaPos = sha256(JSON.stringify(pos));
  let texto = armar(lista, pos);
  informe.bytes = Buffer.byteLength(texto);
  if (informe.bytes > TOPE_BYTES) {
    lista = recortar(lista, u.length, ARISTAS_POR_ARTISTA_SI_SOBRA);
    const t1 = performance.now();
    pos = acomodar(d3, u, lista);
    informe.recorte = { bytesAntes: informe.bytes, layoutMs: Math.round(performance.now() - t1) };
    informe.huellaPos = sha256(JSON.stringify(pos));
    texto = armar(lista, pos);
    informe.bytes = Buffer.byteLength(texto);
  }
  writeFileSync(SALIDA, texto);
  informe.aristas = lista.length;
  informe.mutuas = lista.filter((e) => e.ab && e.ba).length;
  informe.autocorregidos = autocorregidos.length;
  informe.horneado = true;
  console.log(JSON.stringify(informe));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [modo, archivo, rutaD3] = process.argv.slice(2);
  if (!archivo) { console.error('uso: hornear-similares.mjs escanear|hornear <avance.jsonl> [d3.min.js]'); process.exit(2); }
  if (modo === 'escanear') await escanear(archivo);
  else if (modo === 'hornear') hornear(archivo, rutaD3);
  else { console.error('modo desconocido: ' + modo); process.exit(2); }
}
