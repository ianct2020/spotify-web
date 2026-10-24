// tests/copia-cada-await.test.mjs — la copia de OTRA pestaña, inyectada en CADA punto de espera (tanda 82, v=339)
//
// Desde v=339, cuando otra pestaña importa una copia, los almacenes ya cargados de `util/hidden-sync.js` UNEN a su memoria
// lo que lee `localStorage` (`util/union-en-memoria.js`). Es exacto solo si, en el momento en que llega el mensaje, todo lo
// que esta pestaña QUITÓ de la memoria ya está quitado de `localStorage`. La 81 encontró que `fijarVarios` no lo cumplía
// (borraba tanda por tanda y guardaba al final, con `await` en el medio) y lo arregló. Esta suite es la evidencia de que no
// queda OTRO hueco igual:
//
//   R  la regla, leída en el texto: después de cada borrado o reasignación de `keys`/`uriByKey`, un `saveLocal`/`saveUris`
//      antes del siguiente `await` (y, en un bucle con un `await`, antes de que cierre el cuerpo). La única que ve una
//      función NUEVA que alguien escriba mañana;
//   B  la fuerza bruta, conductual: cada operación que muta un almacén, con el import y el mensaje inyectados en CADA punto
//      de espera (cada llamada a la Spotify doblada, a la IndexedDB doblada o a `recoverUri`, antes y después de su
//      respuesta: `dobles/puntos.mjs`), con una copia al azar. Al terminar:
//        1. nada que esta pestaña quitó vuelve, salvo que la copia lo trajera;
//        2. todo lo que agregó la copia está en lo guardado;
//        3. `keys` y `localStorage` coinciden;
//      y, más fuerte, lo guardado es EXACTAMENTE lo de sin copia ∪ lo que agregó la copia.
//
// `OCULTOS_MODULO=<ruta a hidden-sync.js>` corre contra OTRO árbol (sin el arreglo de `fijarVarios`, un `toggle`
// saboteado…). `SOLO=R,B` corre una parte. 🔴 Todo INVENTADO: sin navegador, sin token, sin red.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

console.info = () => {};
console.warn = () => {};   // los avisos de «sin uri» de cada sync taparían los asserts

let pasaron = 0, fallaron = 0;
const fallos = [];
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; fallos.push(nombre); console.log(`  ✗ ${nombre}`); }
}
const J = JSON.stringify;
const SOLO = process.env.SOLO ? new Set(process.env.SOLO.split(',')) : null;
const toca = (c) => !SOLO || SOLO.has(c);

const MODULO = process.env.OCULTOS_MODULO || '../src/js/util/hidden-sync.js';
const urlModulo = new URL(MODULO, import.meta.url);

// ── R · la regla, leída en el texto ─────────────────────────────────────────────────────────────

/** El fuente con comentarios, cadenas, plantillas (salvo sus `${…}`) y regex en blanco; los saltos de línea se quedan. */
function limpiar(src) {
  let out = '';
  const pila = [];   // 'tpl' | número (llaves abiertas dentro de un `${…}`)
  let i = 0, previo = '';
  const blanco = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    const enTpl = pila[pila.length - 1] === 'tpl';
    if (enTpl) {
      if (c === '\\') { out += blanco(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { pila.pop(); out += ' '; i++; previo = 'x'; continue; }
      if (c === '$' && d === '{') { pila.push(0); out += '  '; i += 2; previo = '('; continue; }
      out += blanco(c); i++; continue;
    }
    if (c === '/' && d === '/') { const f = src.indexOf('\n', i); const j = f < 0 ? src.length : f; out += blanco(src.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2) + 2; out += blanco(src.slice(i, j)); i = j; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += blanco(src.slice(i, j + 1)); i = j + 1; previo = 'x'; continue;
    }
    if (c === '`') { pila.push('tpl'); out += ' '; i++; continue; }
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(previo) || previo === '' || /\b(return|typeof|case|of|in)$/.test(out.trimEnd()))) {
      let j = i + 1, clase = false;
      while (j < src.length && (clase || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') clase = true; else if (src[j] === ']') clase = false; j++; }
      j++;
      while (/[a-z]/i.test(src[j] || '')) j++;
      out += blanco(src.slice(i, j)); i = j; previo = 'x'; continue;
    }
    if (typeof pila[pila.length - 1] === 'number') {
      if (c === '{') pila[pila.length - 1]++;
      else if (c === '}') {
        if (pila[pila.length - 1] === 0) { pila.pop(); out += ' '; i++; previo = 'x'; continue; }
        pila[pila.length - 1]--;
      }
    }
    out += c; i++;
    if (!/\s/.test(c)) previo = c;
  }
  return out;
}

/** Las violaciones de la regla en `src`: `[{ linea, que }]`. */
function violaciones(src) {
  const t = limpiar(src);
  const lineaDe = (pos) => t.slice(0, pos).split('\n').length;
  const res = [];
  const marcos = [];   // { bucle, conAwait }
  const llavesDeBucle = new Set();
  const pend = { keys: null, uris: null };   // { linea, prof }
  const re = /\b(?:for|while)\s*\(|\bawait\b|\bsaveLocal\(|\bsaveUris\(|\b(?:keys|uriByKey)\.(?:delete|clear)\(|(?<![\w.$])(?:keys|uriByKey)\s*=(?![=>])|[{}]/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m[0], pos = m.index;
    if (/^(for|while)/.test(s)) {
      // El cuerpo del bucle: la llave que sigue al paréntesis que cierra la cabecera.
      let j = pos + s.length, prof = 1;
      while (j < t.length && prof) { if (t[j] === '(') prof++; else if (t[j] === ')') prof--; j++; }
      while (/\s/.test(t[j])) j++;
      if (t[j] === '{') llavesDeBucle.add(j);
    } else if (s === '{') {
      marcos.push({ bucle: llavesDeBucle.has(pos), conAwait: false });
    } else if (s === '}') {
      const prof = marcos.length;
      const mk = marcos.pop();
      if (mk?.bucle && mk.conAwait) {
        for (const q of ['keys', 'uris']) {
          if (pend[q] && pend[q].prof >= prof) { res.push({ linea: pend[q].linea, que: `${q === 'keys' ? 'keys' : 'uriByKey'} cambia dentro de un bucle con await (línea ${lineaDe(pos)}) y no se guarda antes de la vuelta` }); pend[q] = null; }
        }
      }
    } else if (s === 'await') {
      for (const mk of marcos) mk.conAwait = true;
      for (const q of ['keys', 'uris']) {
        if (pend[q]) { res.push({ linea: pend[q].linea, que: `${q === 'keys' ? 'keys' : 'uriByKey'} cambia y llega un await (línea ${lineaDe(pos)}) sin guardar` }); pend[q] = null; }
      }
    } else if (s === 'saveLocal(') pend.keys = null;
    else if (s === 'saveUris(') pend.uris = null;
    else {
      const q = s.startsWith('keys') ? 'keys' : 'uris';
      const antes = t.slice(Math.max(0, pos - 8), pos);
      const despues = t.slice(pos + s.length, pos + s.length + 16);
      if (/=$/.test(s) && (/\b(let|const|var)\s+$/.test(antes) || /^\s*(loadLocal|loadUris)\(/.test(despues))) continue;
      pend[q] = { linea: lineaDe(pos), prof: marcos.length };
    }
  }
  return res;
}

if (toca('R')) {
  console.log('\nR · la regla, en el texto de hidden-sync.js');
  // Que el lector lea bien: cinco casos escritos a mano.
  ok(violaciones('async function f(){ keys.delete(a); saveLocal(k, keys); await x(); }').length === 0, 'el lector: borrar, guardar y después esperar → 0');
  ok(violaciones('async function f(){ keys.delete(a); await x(); saveLocal(k, keys); }').length === 1, 'el lector: borrar, esperar y después guardar → 1');
  ok(violaciones('async function f(){ for (const t of ts) { await x(); for (const k of t) { keys.delete(k); } } saveLocal(k, keys); }').length === 1, 'el lector: borrar en un bucle con await y guardar al final → 1 (la vuelta del bucle)');
  ok(violaciones('async function f(){ for (const t of ts) { await x(); for (const k of t) { uriByKey.delete(k); } saveUris(k, uriByKey); } }').length === 0, 'el lector: guardar al cerrar cada vuelta → 0');
  ok(violaciones('function f(){ if (!keys) keys = loadLocal(k); const s = `${a ? "{" : "}"} await`; const r = /[{]await/; return keys; }').length === 0, 'el lector: la carga perezosa, las cadenas, las plantillas y los regex no cuentan → 0');
  const fuente = readFileSync(urlModulo, 'utf8');
  const v = violaciones(fuente);
  ok(v.length === 0, `🔴 hidden-sync.js cumple la regla (${v.length} violaciones${v.length ? ': ' + v.map((x) => `l.${x.linea} ${x.que}`).join(' · ') : ''})`);
  ok((fuente.match(/\bkeys\.delete\(|\buriByKey\.delete\(/g) || []).length >= 8, 'y la regla tiene qué mirar: al menos 8 borrados de la memoria en el archivo');
}

// ── B · la fuerza bruta ─────────────────────────────────────────────────────────────────────────

const lsMapa = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
};
const canales = [];
globalThis.BroadcastChannel = class {
  constructor(nombre) { this.nombre = nombre; this.oyentes = []; canales.push(this); }
  postMessage(m) { for (const c of canales) if (c !== this && c.nombre === this.nombre) c.oyentes.forEach((f) => f({ data: structuredClone(m) })); }
  addEventListener(t, f) { if (t === 'message') this.oyentes.push(f); }
};

register('./dobles/loader-puntos.mjs', pathToFileURL(import.meta.filename));
const HS = await import(urlModulo.href);
const otraPestana = new globalThis.BroadcastChannel('fonoteca-copia');
const llegaCopia = () => otraPestana.postMessage({ tipo: 'importada', fecha: '2026-10-24T12:00:00.000Z', origen: 'otra-pestana-t82' });

const UID = 't82-uid-inventado';
const P = (b) => `${b}__${UID}`;
const tid = (s) => (s + 'x'.repeat(22)).slice(0, 22);
const uri = (k) => `spotify:track:${k}`;
const pista = (id) => ({ id, uri: uri(id), name: id, artists: [{ name: 'X' }], album: { name: 'A' } });
const ordenado = (it) => [...it].sort();
const mismo = (a, b) => J(ordenado(a)) === J(ordenado(b));

// Cada caso con su propio `lsKey`: los almacenes de casos viejos siguen apuntados a la unión (no hay forma de darlos de
// baja), y así leen una clave que ya no existe en vez de volver a parsear la de este.
let nCaso = 0;
function montar(lsKey, { playlist = [], local = [], uris = {} }) {
  lsMapa.clear();
  lsMapa.set('fonoteca_last_user_id', UID);
  lsMapa.set(P(`fonoteca_hidden_pl_${lsKey}`), `pl-${lsKey}`);
  lsMapa.set(P(lsKey), J(local));
  lsMapa.set(P(`${lsKey}_uris`), J(uris));
  globalThis.__DOBLE = {
    me: UID,
    playlists: [{ id: `pl-${lsKey}`, name: `fonoteca · ocultos (${lsKey})`, owner: UID, items: playlist.map(pista) }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [], paginas: [],
    pistaDeUri: (u) => pista(u.split(':').pop()),
  };
  globalThis.__FALLA_ESCRITURA = null;
  globalThis.__PUNTOS = null;
}
const guardadas = (lsKey) => JSON.parse(lsMapa.get(P(lsKey)) || '[]');
const urisGuardadas = (lsKey) => JSON.parse(lsMapa.get(P(`${lsKey}_uris`)) || '{}');
/** Lo que hace el import de la 79 (`copia-importar.js`) con un conjunto, su mapa y la marca: une, nunca quita; en el mapa gana lo tuyo. */
function importar(lsKey, claves, uris) {
  const ya = guardadas(lsKey);
  const agregado = claves.filter((k) => !ya.includes(k));
  lsMapa.set(P(lsKey), J([...ya, ...agregado]));
  const m = urisGuardadas(lsKey);
  for (const [k, v] of Object.entries(uris)) if (!(k in m)) m[k] = v;
  lsMapa.set(P(`${lsKey}_uris`), J(m));
  const marca = JSON.parse(lsMapa.get(P('ocultos_desde_copia_v1')) || '{}');
  marca[lsKey] = [...new Set([...(marca[lsKey] || []), ...agregado])];
  if (marca[lsKey].length) lsMapa.set(P('ocultos_desde_copia_v1'), J(marca));
  return agregado;
}
/** Hasta que no quede nada en vuelo (el `toggle` sube en segundo plano). */
async function asentar() {
  let quietas = 0, ultimo = -1;
  while (quietas < 20) {
    await new Promise((r) => setImmediate(r));
    const n = globalThis.__CONTADOR_PUNTOS || 0;
    if (n === ultimo) quietas++; else { quietas = 0; ultimo = n; }
  }
}

const SEMILLA = 0x82a7a17;
let st = SEMILLA;
const azar = () => { st |= 0; st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// Las claves: `id(n)` es un id de pista (la uri se deduce), `su(n)` no lo es y no tiene uri (no se puede subir).
const id = (n) => tid(`t82i${n}`);
const su = (n) => `t82-sin-uri-${n}`;
const rango = (n, f, desde = 0) => Array.from({ length: n }, (_, i) => f(desde + i));

/**
 * Los escenarios. `estado`: lo que hay antes (playlist, local, uris). `op(s)`: la operación. `fuera`: claves que no están y
 * que una copia podría traer. Cada uno corre una vez SIN copia (para saber el resultado y contar los puntos) y después una
 * vez por punto y por copia.
 */
function escenarios() {
  const E = [];
  const base = rango(6, id);
  const conUris = (ks) => Object.fromEntries(ks.filter((k) => !k.startsWith('t82-sin')).map((k) => [k, uri(k)]));
  E.push({ nombre: 'toggle ocultar', estado: { playlist: base, local: base, uris: conUris(base) }, op: (s) => s.toggle(id(100), uri(id(100))), fuera: [id(100), id(101), su(1)] });
  E.push({ nombre: 'toggle devolver', estado: { playlist: base, local: base, uris: conUris(base) }, op: (s) => s.toggle(id(2)), fuera: [id(101), su(1)] });
  E.push({ nombre: 'toggle ocultar sin uri', estado: { playlist: base, local: base, uris: conUris(base) }, op: (s) => s.toggle(su(5)), fuera: [su(5), id(101)] });
  // `mezcla`: una de cada diez sin uri. Sin mezcla, todas con uri: es la única forma de que 101 entradas sean dos tandas
  // (las tandas son de las que tienen uri, de a 100).
  for (const [n, mezcla] of [[1, false], [100, false], [100, true], [101, false], [101, true], [250, false], [250, true]]) {
    for (const falla of [false, true]) {
      const sinUri = (i) => mezcla && i % 10 === 9;
      const etiqueta = `${n}${mezcla ? ' mezcladas' : ' con uri'}`;
      // Ocultar: n claves nuevas (las sin uri no se pueden ocultar: salen en `fallidas`).
      const nuevas = rango(n, (i) => (sinUri(i) ? su(i) : id(1000 + i)));
      const nTandas = Math.ceil(nuevas.filter((k) => !k.startsWith('t82-sin')).length / 100) || 1;
      E.push({
        nombre: `fijarVarios ocultar ${etiqueta}${falla ? ` (falla la tanda ${Math.min(2, nTandas)})` : ''}`,
        estado: { playlist: base, local: base, uris: conUris(base) },
        falla: falla ? { metodo: 'add', n: Math.min(2, nTandas) } : null,
        op: (s) => s.fijarVarios(nuevas.map((key) => ({ key, uri: key.startsWith('t82-sin') ? null : uri(key) })), true),
        fuera: [...nuevas.slice(0, 5), ...nuevas.slice(-5), id(9000), su(9000)],
      });
      // Devolver: n claves ocultas (las sin uri viven solo en este navegador: se devuelven sin tocar la playlist).
      const ocultas = rango(n, (i) => (sinUri(i) ? su(500 + i) : id(5000 + i)));
      const enPlaylist = ocultas.filter((k) => !k.startsWith('t82-sin'));
      const nT = Math.ceil(enPlaylist.length / 100) || 1;
      E.push({
        nombre: `fijarVarios devolver ${etiqueta}${falla ? ` (falla la tanda ${Math.min(2, nT)})` : ''}`,
        estado: { playlist: [...base, ...enPlaylist], local: [...base, ...ocultas], uris: conUris([...base, ...enPlaylist]) },
        falla: falla ? { metodo: 'remove', n: Math.min(2, nT) } : null,
        op: (s) => s.fijarVarios(ocultas.map((key) => ({ key })), false),
        fuera: [...ocultas.slice(0, 5), ...ocultas.slice(-5), id(9000), su(9001)],
      });
    }
  }
  // Uno de una sola clave SIN uri, para el «devolver sin uri» solo.
  E.push({ nombre: 'fijarVarios devolver 1 sin uri', estado: { playlist: base, local: [...base, su(77)], uris: conUris(base) }, op: (s) => s.fijarVarios([{ key: su(77) }], false), fuera: [su(77), id(9000)] });
  E.push({ nombre: 'clear()', estado: { playlist: base, local: [...base, su(3)], uris: conUris(base) }, op: (s) => s.clear(), fuera: [id(1), su(3), id(9000)] });
  E.push({ nombre: 'renameKey', estado: { playlist: base, local: [...base, su(3)], uris: conUris(base) }, op: (s) => s.renameKey(su(3), su(4)), fuera: [su(3), su(4), id(9000)] });
  // sync() en una carga nueva: sin nada que subir, y con algo (una perdida con su uri y dos que nunca subieron).
  E.push({ nombre: 'sync() sin nada que subir', estado: { playlist: base, local: base, uris: conUris(base) }, sinCargar: true, op: (s) => s.ready(), fuera: [id(1), id(9000), id(9001), su(9)] });
  E.push({ nombre: 'sync() con cosas que subir', estado: { playlist: base.slice(0, 4), local: [...base, id(60), id(61)], uris: conUris(base) }, sinCargar: true, op: (s) => s.ready(), fuera: [id(4), id(60), id(9000), id(9001), su(9)] });
  return E;
}

const crear = (lsKey) => HS.createHiddenStore({ lsKey, playlistName: `fonoteca · ocultos (${lsKey})`, label: lsKey, keyOfTrack: (t) => t?.id || null, uriFromKey: (k) => (/^[A-Za-z0-9]{22}$/.test(k) ? uri(k) : null) });

/** Una corrida: `inyectar` = { k, copia } o null. Devuelve lo que hace falta para afirmar. */
async function correr(esc, inyectar) {
  const lsKey = `t82c${++nCaso}`;
  montar(lsKey, esc.estado);
  const s = crear(lsKey);
  if (!esc.sinCargar) { await s.ready(); await asentar(); }
  const antes = new Set(esc.sinCargar ? esc.estado.local : s.values());
  globalThis.__FALLA_ESCRITURA = esc.falla ? { ...esc.falla, cuenta: 0 } : null;
  let n = 0, agregado = null, copia = null;
  globalThis.__CONTADOR_PUNTOS = 0;
  globalThis.__PUNTOS = async () => {
    n++; globalThis.__CONTADOR_PUNTOS = n;
    if (inyectar && n === inyectar.k) {
      copia = inyectar.copia;
      agregado = importar(lsKey, copia, Object.fromEntries(copia.filter((k) => !k.startsWith('t82-sin') || azar() < 0.3).map((k) => [k, uri(k.startsWith('t82-sin') ? tid('t82r' + k.slice(-3)) : k)])));
      llegaCopia();
    }
  };
  await esc.op(s);
  await asentar();
  globalThis.__PUNTOS = null;
  return { antes, final: new Set(guardadas(lsKey)), memoria: new Set(s.values()), puntos: n, agregado: new Set(agregado || []), copia: new Set(copia || []) };
}

if (toca('B')) {
  const REPETICIONES = 10;   // copias al azar distintas por punto
  console.log(`\nB · el import y el mensaje en cada punto de espera · semilla 0x${SEMILLA.toString(16)} · ${REPETICIONES} copias por punto`);
  let totalCasos = 0, totalPuntos = 0;
  for (const esc of escenarios()) {
    const sin = await correr(esc, null);
    const quitadas = [...sin.antes].filter((k) => !sin.final.has(k));
    let r1 = 0, r2 = 0, r3 = 0, rx = 0;
    const ej = [];
    for (let k = 1; k <= sin.puntos; k++) {
      for (let r = 0; r < REPETICIONES; r++) {
        const universo = [...new Set([...esc.fuera, ...sin.antes, ...quitadas])];
        const copia = universo.filter(() => azar() < 0.35);
        const c = await correr(esc, { k, copia });
        totalCasos++;
        const volvieron = quitadas.filter((q) => c.final.has(q) && !c.copia.has(q));
        if (volvieron.length) { r1++; if (ej.length < 2) ej.push(`punto ${k}: vuelven ${volvieron.length}`); }
        if ([...c.agregado].some((a) => !c.final.has(a))) r2++;
        if (!mismo(c.memoria, c.final)) r3++;
        if (!mismo(c.final, new Set([...sin.final, ...c.agregado]))) rx++;
      }
    }
    totalPuntos += sin.puntos;
    const casos = sin.puntos * REPETICIONES;
    console.log(`  · ${esc.nombre}: ${sin.puntos} puntos de espera, ${casos} casos (quita ${quitadas.length} sin copia)`);
    ok(r1 === 0, `${esc.nombre}: 🔴 nada de lo que esta pestaña quitó vuelve (salvo que lo trajera la copia) (${r1} de ${casos}${ej.length ? ': ' + ej.join(' · ') : ''})`);
    ok(r2 === 0 && r3 === 0, `${esc.nombre}: lo que agregó la copia está guardado (${r2} de ${casos} no) y la memoria = localStorage (${r3} de ${casos} no)`);
    ok(rx === 0, `${esc.nombre}: lo guardado es EXACTAMENTE lo de sin copia ∪ lo que agregó la copia (${rx} de ${casos} no)`);
  }
  console.log(`  ${totalCasos} casos · ${totalPuntos} puntos de espera en total`);

  // Los dos dueños de memoria de este archivo: el de «ya escuchado» (`createLocalStore`) no espera nunca.
  const L = HS.createLocalStore({ lsKey: 't82-local', label: 't82-local' });
  globalThis.__CONTADOR_PUNTOS = 0; let n = 0;
  globalThis.__PUNTOS = async () => { n++; };
  L.toggle(id(1), uri(id(1))); L.add(id(2), uri(id(2))); L.toggle(id(1)); L.renameKey(id(2), id(3)); await L.clear();
  await asentar();
  globalThis.__PUNTOS = null;
  ok(n === 0, `createLocalStore (toggle, add, renameKey, clear): ${n} puntos de espera, nada que inyectar (es sincrónico)`);
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
if (fallaron) console.log('fallaron:\n' + fallos.map((f) => '  · ' + f).join('\n'));
process.exit(fallaron ? 1 : 0);
