// tests/copia-otra-pestana.test.mjs — la OTRA pestaña une a su memoria lo que trajo la copia (tanda 81; entra en v=339, tanda 82)
//
// Los almacenes de `util/hidden-sync.js` (`createHiddenStore`, los seis de ocultos; `createLocalStore`, «ya escuchado»)
// leen su conjunto una vez por carga y lo guardan ENTERO desde la memoria. Hasta v=336, si otra pestaña importaba una
// copia y acá se tocaba un almacén ya cargado, se guardaba lo viejo encima de lo importado. El diseño de la 81: al llegar
// `{ tipo: 'importada' }` por `util/canal-copia.js`, cada almacén YA cargado une a su memoria lo que lee ahora
// `localStorage` (`util/union-en-memoria.js`), y nada más.
//
// Lo que se vigila:
//   A  el rojo: memoria {a}; el import deja {a, x}; llega el mensaje; se oculta z → lo guardado es {a, x, z} (v=336: {a, z}).
//      En los SIETE almacenes con los nombres de verdad;
//   B  lo quitado en esta pestaña antes del mensaje y que el import no trajo, sigue quitado (y si el import lo trae, vuelve:
//      el precio de «nunca borra», dicho);
//   C  las uris: agrega lo que falta y no pisa;
//   D  un almacén que no cargó: nada; y al llegar el mensaje, 0 escrituras y 0 peticiones;
//   E  el mensaje durante un `sync()` en vuelo: bajando la playlist (E1) y subiendo (E2);
//   F  la pestaña que importa no se une a sí misma;
//   G  `fijarVarios` entre dos tandas (un «devolver» de más de 100): el caso que rompe la regla de la unión;
//   H  la fuerza bruta: nada de la memoria se pierde, y lo guardado es memoria ∪ lo que agregó el import.
//
// `OCULTOS_MODULO=<ruta a hidden-sync.js>` corre contra OTRO árbol (v=336, una unión saboteada…). `SOLO=A,H` corre algunos.
// 🔴 Todo INVENTADO. Sin navegador, sin token, sin red: el `api.js` doblado de siempre (`dobles/loader.mjs`), un
// `localStorage` de mentira (con una cuota que se puede hacer fallar) y un `BroadcastChannel` de mentira que entrega en
// el acto.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

console.info = () => {};   // los `console.info` de `hidden-sync.js` (uno por sync) taparían los asserts

let pasaron = 0, fallaron = 0;
const fallos = [];
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; fallos.push(nombre); console.log(`  ✗ ${nombre}`); }
}
const J = JSON.stringify;
const ordenado = (it) => [...it].sort();
const mismoConjunto = (a, b) => J(ordenado(a)) === J(ordenado(b));
const SOLO = process.env.SOLO ? new Set(process.env.SOLO.split(',')) : null;
const toca = (c) => !SOLO || SOLO.has(c);

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const UID = 't81-uid-inventado';
const P = (b) => `${b}__${UID}`;
const lsMapa = new Map();
// `falla(k)`: si devuelve true, ese `setItem` tira (la cuota). `setItems`: cuántas escrituras hubo.
const lsCtl = { falla: null, setItems: 0 };
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { if (lsCtl.falla && lsCtl.falla(k)) { const e = new Error('QuotaExceededError (doble)'); e.name = 'QuotaExceededError'; throw e; } lsCtl.setItems++; lsMapa.set(k, String(v)); },
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

register('./dobles/loader.mjs', pathToFileURL(import.meta.filename));
const MODULO = process.env.OCULTOS_MODULO || '../src/js/util/hidden-sync.js';
const urlModulo = new URL(MODULO, import.meta.url);
const HS = await import(urlModulo.href);
// El canal de ESTA pestaña es el que importa `hidden-sync.js` (la misma instancia del módulo).
const CC = await import(new URL('./canal-copia.js', urlModulo).href);
const otraPestana = new globalThis.BroadcastChannel('fonoteca-copia');
const llegaCopia = () => otraPestana.postMessage({ tipo: 'importada', fecha: '2026-10-24T12:00:00.000Z', origen: 'otra-pestana-inventada' });

// ── Andamiaje ───────────────────────────────────────────────────────────────────────────────────
const tid = (s) => (s + 'x'.repeat(22)).slice(0, 22);
const uri = (k) => `spotify:track:${k}`;
const uriDeTrackId = (k) => (/^[A-Za-z0-9]{22}$/.test(k) ? uri(k) : null);
const pista = (id) => ({ id, uri: uri(id), name: id, artists: [{ name: 'X' }], album: { name: 'A' } });
const OCULTOS = ['wthree_hidden_albums', 'zeroplays_hidden_tracks', 'recs_ocultos', 'discover_ocultos', 'sin_clasificar_ocultas', 'skips_hidden_tracks'];
const ESCUCHADOS = 'discover_escuchados';
const plDe = (lsKey) => `pl-${lsKey}`.slice(0, 22);

/** Un navegador limpio: `localStorage` con el uid y los ids de las seis playlists; la Spotify doblada con sus listas. */
function montar(playlists = {}) {
  lsMapa.clear(); lsCtl.falla = null; lsCtl.setItems = 0;
  lsMapa.set('fonoteca_last_user_id', UID);
  for (const k of OCULTOS) lsMapa.set(P(`fonoteca_hidden_pl_${k}`), plDe(k));
  globalThis.__DOBLE = {
    me: UID,
    playlists: OCULTOS.map((k) => ({ id: plDe(k), name: `fonoteca · ocultos (${k})`, owner: UID, items: (playlists[k] || []).map(pista) })),
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [], paginas: [],
    pistaDeUri: (u) => pista(u.split(':').pop()),
  };
}
const d = () => globalThis.__DOBLE;
const crear = (lsKey) => (lsKey === ESCUCHADOS
  ? HS.createLocalStore({ lsKey, label: 'escuchados-test' })
  : HS.createHiddenStore({ lsKey, playlistName: `fonoteca · ocultos (${lsKey})`, label: lsKey, keyOfTrack: (t) => t?.id || null, uriFromKey: uriDeTrackId }));
const sembrar = (lsKey, claves, uris = Object.fromEntries(claves.map((k) => [k, uri(k)]))) => {
  lsMapa.set(P(lsKey), J(claves)); lsMapa.set(P(`${lsKey}_uris`), J(uris));
};
const guardadas = (lsKey) => JSON.parse(lsMapa.get(P(lsKey)) || '[]');
const urisGuardadas = (lsKey) => JSON.parse(lsMapa.get(P(`${lsKey}_uris`)) || '{}');
/** Lo que hace el import de la 79 con un conjunto y su mapa (`copia-importar.js`): une, nunca quita; en el mapa gana lo tuyo. */
function importar(lsKey, claves, uris = Object.fromEntries(claves.map((k) => [k, uri(k)]))) {
  const ya = guardadas(lsKey);
  lsMapa.set(P(lsKey), J([...ya, ...claves.filter((k) => !ya.includes(k))]));
  const m = urisGuardadas(lsKey);
  for (const [k, v] of Object.entries(uris)) if (!(k in m)) m[k] = v;
  lsMapa.set(P(`${lsKey}_uris`), J(m));
}
/** Carga la memoria del almacén: el sincronizado con su `sync()`; el local, leyendo las claves y las uris. */
async function cargar(s, lsKey, alguna) {
  if (lsKey === ESCUCHADOS) { s.has('nada'); if (alguna) s.remember(alguna, urisGuardadas(lsKey)[alguna] || uri(alguna)); }
  else await s.ready();
}
const asentar = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
const [a, b, x, y, z] = ['a', 'b', 'x', 'y', 'z'].map((s) => tid(`inv81${s}`));

// ── A · el rojo, en los siete almacenes ─────────────────────────────────────────────────────────
if (toca('A')) {
  console.log('\nA · memoria {a}, el import deja {a, x}, llega el mensaje, se oculta z: lo guardado es {a, x, z}');
  for (const lsKey of [...OCULTOS, ESCUCHADOS]) {
    montar({ [lsKey]: [a] });
    sembrar(lsKey, [a]);
    const s = crear(lsKey);
    await cargar(s, lsKey, a);
    importar(lsKey, [x]);
    llegaCopia();
    s.toggle(z, uri(z));
    await asentar();
    ok(mismoConjunto(guardadas(lsKey), [a, x, z]), `🔴 ${lsKey}: guardado {a, x, z} (${guardadas(lsKey).map((k) => k.slice(5, 7)).join(', ')}; v=336: {a, z})`);
    const u = urisGuardadas(lsKey);
    ok(u[a] === uri(a) && u[x] === uri(x) && u[z] === uri(z), `${lsKey}: y las uris de a, x y z`);
  }
}

// ── B · lo quitado sigue quitado ────────────────────────────────────────────────────────────────
if (toca('B')) {
  console.log('\nB · lo quitado en esta pestaña ANTES del mensaje');
  for (const lsKey of ['skips_hidden_tracks', ESCUCHADOS]) {
    montar({ [lsKey]: [a, b] });
    sembrar(lsKey, [a, b]);
    const s = crear(lsKey);
    await cargar(s, lsKey, a);
    s.toggle(b);   // devuelve b: memoria {a}, guardado {a}
    await asentar();
    importar(lsKey, [x]);
    llegaCopia();
    s.toggle(z, uri(z));
    await asentar();
    ok(mismoConjunto(guardadas(lsKey), [a, x, z]) && !s.has(b), `${lsKey}: b, quitado antes y que el import no trajo, sigue quitado (${guardadas(lsKey).map((k) => k.slice(5, 7)).join(', ')})`);

    // El precio dicho: si el import lo vuelve a traer, vuelve (el import nunca borra, y une).
    montar({ [lsKey]: [a, b] });
    sembrar(lsKey, [a, b]);
    const s2 = crear(lsKey);
    await cargar(s2, lsKey, a);
    s2.toggle(b);
    await asentar();
    importar(lsKey, [b, x]);
    llegaCopia();
    ok(s2.has(b) && s2.has(x), `${lsKey}: si el import TRAE b, b vuelve (el precio aceptado de «nunca borra»)`);
  }
}

// ── C · las uris ────────────────────────────────────────────────────────────────────────────────
if (toca('C')) {
  console.log('\nC · las uris: agrega lo que falta y no pisa');
  for (const lsKey of ['discover_ocultos', ESCUCHADOS]) {
    montar({ [lsKey]: [a] });
    sembrar(lsKey, [a]);
    const s = crear(lsKey);
    await cargar(s, lsKey, a);
    // `localStorage` con a y OTRA uri (el import no lo haría: en el mapa gana la tuya; se prueba la unión sola, escrito a
    // mano) y x, que falta.
    lsMapa.set(P(`${lsKey}_uris`), J({ [a]: 'spotify:track:uri-de-otra-a', [x]: uri(x) }));
    lsMapa.set(P(lsKey), J([a, x]));
    llegaCopia();
    s.toggle(z, uri(z));
    await asentar();
    const u = urisGuardadas(lsKey);
    ok(u[a] === uri(a), `${lsKey}: a con otra uri en los dos lados: gana la de memoria (${u[a]})`);
    ok(u[x] === uri(x) && u[z] === uri(z), `${lsKey}: x (la que faltaba) se agrega`);
  }
}

// ── D · perezoso, y la unión no escribe ni pide nada ────────────────────────────────────────────
if (toca('D')) {
  console.log('\nD · un almacén que no cargó; y la unión sola no escribe ni pide');
  montar({ skips_hidden_tracks: [a] });
  sembrar('skips_hidden_tracks', [a]);
  const s = crear('skips_hidden_tracks');   // sin leer nada: perezoso
  importar('skips_hidden_tracks', [x]);
  const antes = lsCtl.setItems, llamadas = d().llamadas.length;
  llegaCopia();
  ok(lsCtl.setItems === antes && d().llamadas.length === llamadas, `no cargado: el mensaje no escribe ni pide nada (${lsCtl.setItems - antes} escrituras, ${d().llamadas.length - llamadas} peticiones)`);
  ok(s.has(x) && s.has(a), 'y la primera lectura trae lo nuevo');

  montar({ skips_hidden_tracks: [a] });
  sembrar('skips_hidden_tracks', [a]);
  const s2 = crear('skips_hidden_tracks');
  await s2.ready();
  importar('skips_hidden_tracks', [x]);
  const antes2 = lsCtl.setItems, llamadas2 = d().llamadas.length, post2 = d().añadidas.length;
  llegaCopia();
  await asentar();
  ok(lsCtl.setItems === antes2 && d().llamadas.length === llamadas2 && d().añadidas.length === post2, `cargado: la unión no guarda, no sincroniza y no toca la playlist (${lsCtl.setItems - antes2} escrituras, ${d().llamadas.length - llamadas2} peticiones)`);
  ok(s2.has(x), 'pero la memoria ya tiene x');
}

// ── E · el mensaje durante un sync() en vuelo ───────────────────────────────────────────────────
if (toca('E')) {
  console.log('\nE · el mensaje durante un sync() en vuelo');
  const K = 'skips_hidden_tracks';
  // E1a: bajando la playlist. Local {a, b}, playlist {a, x}; la copia trae x (ya está en la playlist).
  montar({ [K]: [a, x] });
  sembrar(K, [a, b]);
  const s = crear(K);
  d().durantePaginas = async () => { d().durantePaginas = null; importar(K, [x]); llegaCopia(); };
  await s.ready();
  await asentar();
  ok(mismoConjunto(guardadas(K), [a, b, x]), `E1 (bajando): el sync() termina y guarda lo agregado (${guardadas(K).map((k) => k.slice(5, 7)).join(', ')})`);
  ok(J(d().añadidas) === J([{ id: plDe(K), uris: [uri(b)] }]) && d().quitadas.length === 0, `E1 (bajando, la copia trae lo que la playlist ya tiene): las escrituras, las de v=336: POST [b] (${J(d().añadidas)})`);

  // E1b: la copia trae y, que NO está en la playlist: ese mismo sync() la sube.
  montar({ [K]: [a] });
  sembrar(K, [a, b]);
  const s1b = crear(K);
  // (tanda 82) Como `aplicarPlan`: la otra pestaña deja también la marca de la copia (`ocultos_desde_copia_v1`) antes de
  // mandar el mensaje.
  const MARCA = P('ocultos_desde_copia_v1');
  d().durantePaginas = async () => { d().durantePaginas = null; importar(K, [y]); lsMapa.set(MARCA, J({ [K]: [y] })); llegaCopia(); };
  await s1b.ready();
  await asentar();
  ok(J(d().añadidas) === J([{ id: plDe(K), uris: [uri(b), uri(y)] }]), `E1b (bajando, la copia trae y, que la playlist no tiene): ESE sync() sube [b, y]; v=336 subía [b] y perdía y (${J(d().añadidas)})`);
  // (tanda 82, v=338) y entra por `porSubir` (llegó a `uriByKey` después de la foto `sabidasAlEmpezar`): el aviso de la
  // copia tiene que mirarla. b es una pérdida de verdad (su uri ya estaba): su aviso amarillo, aparte.
  const copiaAvisos = d().toasts.filter((t) => /venía de tu copia|venían de tu copia/.test(t.message));
  const incid = JSON.parse(lsMapa.get(P('ocultos_incidencias_v1')) || '[]');
  ok(copiaAvisos.length === 1 && copiaAvisos[0].type === 'info' && /un oculto que venía de tu copia/.test(copiaAvisos[0].message),
    `E1b: UN aviso «…un oculto que venía de tu copia» por y (${d().toasts.map((t) => `${t.type}: ${t.message}`).join(' | ') || 'ninguno'})`);
  ok(J(incid.filter((i) => i.tipo === 'desde-copia').map((i) => i.claves)) === J([[y]]) && !incid.some((i) => i.tipo === 'resubida' && i.claves.includes(y)),
    `E1b: UNA incidencia \`desde-copia\` con y, y y no está en ninguna \`resubida\` (${J(incid.map((i) => [i.tipo, (i.claves || []).map((k) => k.slice(5, 7))]))})`);
  ok(!(JSON.parse(lsMapa.get(MARCA) || '{}')[K] || []).includes(y), `E1b: y ya no está en la marca (${lsMapa.get(MARCA)})`);

  // E2: subiendo (el mensaje llega en el `antesDeEscribir` del POST): lo que sube ya estaba decidido.
  montar({ [K]: [a] });
  sembrar(K, [a, b]);
  const s2 = crear(K);
  let disparado = false;
  d().idbBorrados = Object.assign([], { push(...v) { if (!disparado) { disparado = true; importar(K, [y]); llegaCopia(); } return Array.prototype.push.apply(this, v); } });
  await s2.ready();
  await asentar();
  ok(disparado && J(d().añadidas) === J([{ id: plDe(K), uris: [uri(b)] }]), `E2 (subiendo): las escrituras, idénticas a las de v=336: POST [b] (${J(d().añadidas)})`);
  ok(mismoConjunto(guardadas(K), [a, b, y]) && urisGuardadas(K)[y] === uri(y), `E2: lo de la copia sigue guardado (${guardadas(K).map((k) => k.slice(5, 7)).join(', ')})`);
  ok(s2.has(y), 'E2: y la memoria lo tiene');
}

// ── F · la pestaña que importa no se une a sí misma ─────────────────────────────────────────────
if (toca('F')) {
  console.log('\nF · la pestaña que importa no recibe su propio mensaje');
  const K = 'skips_hidden_tracks';
  montar({ [K]: [a] });
  sembrar(K, [a]);
  const s = crear(K);
  await s.ready();
  importar(K, [x]);
  CC.avisarCopiaImportada('2026-10-24T12:00:00.000Z');   // el mensaje que manda ESTA pestaña
  ok(!s.has(x), 'su propio mensaje no la une (la que importa se recarga)');
}

// ── G · fijarVarios entre dos tandas ────────────────────────────────────────────────────────────
if (toca('G')) {
  console.log('\nG · un «devolver» de 150 (dos tandas) y el mensaje entre las dos');
  const K = 'discover_ocultos';
  const muchos = Array.from({ length: 150 }, (_, i) => tid(`inv81g${i}`));
  montar({ [K]: muchos });
  sembrar(K, muchos);
  const s = crear(K);
  await s.ready();
  let n = 0;
  d().idbBorrados = Object.assign([], { push(...v) { if (++n === 2) { importar(K, [x]); llegaCopia(); } return Array.prototype.push.apply(this, v); } });
  const r = await s.fijarVarios(muchos.map((key) => ({ key })), false);
  await asentar();
  const quedaron = guardadas(K).filter((k) => muchos.includes(k));
  ok(r.hechas.length === 150 && d().quitadas.length === 2, `las dos tandas se quitaron de la playlist (${r.hechas.length} hechas, ${d().quitadas.length} DELETE)`);
  ok(quedaron.length === 0, `🔴 lo devuelto en la primera tanda NO vuelve (vuelven ${quedaron.length} de 150 a «ocultos» en este navegador)`);
  ok(guardadas(K).includes(x), 'y lo de la copia queda');
}

// ── H · la fuerza bruta ─────────────────────────────────────────────────────────────────────────
if (toca('H')) {
  const SEMILLA = 0x81c0b1a;
  let st = SEMILLA;
  const azar = () => { st |= 0; st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const U = Array.from({ length: 12 }, (_, i) => tid(`inv81u${i}`));
  const subconjunto = (p) => U.filter(() => azar() < p);
  const uriAzar = (k) => (azar() < 0.3 ? `spotify:track:otra${k.slice(-6)}` : uri(k));
  const NUEVA = tid('inv81nueva');

  // F1: todas las escrituras salen bien (lo normal). Exacto.
  // F2: algunas escrituras de esta pestaña fallan por la cuota (memoria ≠ localStorage antes del import). Conservación.
  const familias = [
    { nombre: 'F1 · createLocalStore', lsKey: ESCUCHADOS, memorias: 40, copias: 25, cuota: false },
    { nombre: 'F1 · createHiddenStore', lsKey: 'zeroplays_hidden_tracks', memorias: 12, copias: 10, cuota: false },
    { nombre: 'F2 · createLocalStore, con escrituras que fallan', lsKey: ESCUCHADOS, memorias: 30, copias: 20, cuota: true },
  ];
  console.log(`\nH · fuerza bruta, semilla 0x${SEMILLA.toString(16)}`);
  for (const f of familias) {
    let casos = 0, perdidos = 0, urisCambiadas = 0, noExactos = 0, revividos = 0;
    const ejemplos = [];
    for (let m = 0; m < f.memorias; m++) {
      const inicial = subconjunto(0.4);
      const urisIni = Object.fromEntries(inicial.map((k) => [k, uriAzar(k)]));
      const ops = Array.from({ length: 1 + Math.floor(azar() * 5) }, () => ({ k: U[Math.floor(azar() * U.length)], u: uriAzar(U[0]), falla: f.cuota && azar() < 0.35 }));
      for (let c = 0; c < f.copias; c++) {
        const copia = subconjunto(0.35);
        const urisCopia = Object.fromEntries(copia.map((k) => [k, uriAzar(k)]));
        montar({ [f.lsKey]: f.lsKey === ESCUCHADOS ? [] : inicial });
        sembrar(f.lsKey, inicial, urisIni);
        const s = crear(f.lsKey);
        await cargar(s, f.lsKey, inicial[0]);
        // Lo que hace esta pestaña ANTES del mensaje: oculta y devuelve (en F2, a veces sin poder guardar).
        for (const op of ops) {
          lsCtl.falla = op.falla ? (k) => k === P(f.lsKey) || k === P(`${f.lsKey}_uris`) : null;
          s.has(op.k) ? s.toggle(op.k) : s.toggle(op.k, op.k === U[0] ? op.u : uri(op.k));
          lsCtl.falla = null;
        }
        await asentar();
        const memoria = new Set(s.values());
        const lsAntes = new Set(guardadas(f.lsKey));
        const urisAntes = urisGuardadas(f.lsKey);
        importar(f.lsKey, copia, urisCopia);
        const agregado = new Set(guardadas(f.lsKey).filter((k) => !lsAntes.has(k)));
        llegaCopia();
        s.toggle(NUEVA, uri(NUEVA));   // la próxima escritura del almacén
        await asentar();
        const guardado = new Set(guardadas(f.lsKey));
        const urisDesp = urisGuardadas(f.lsKey);
        casos++;
        const faltan = [...memoria].filter((k) => !guardado.has(k));
        if (faltan.length) { perdidos++; if (ejemplos.length < 2) ejemplos.push(`memoria ${memoria.size}, faltan ${faltan.length}`); }
        if (!f.cuota && Object.entries(urisAntes).some(([k, v]) => k in urisDesp && urisDesp[k] !== v)) urisCambiadas++;
        const esperado = new Set([...memoria, ...agregado, NUEVA]);
        if (!mismoConjunto(guardado, esperado)) {
          noExactos++;
          if ([...guardado].some((k) => !esperado.has(k) && lsAntes.has(k) && !memoria.has(k))) revividos++;
        }
      }
    }
    console.log(`  ${f.nombre}: ${casos} casos (${f.memorias} memorias × ${f.copias} copias)`);
    ok(perdidos === 0, `${f.nombre}: 🔴 nada de lo que la pestaña tenía en memoria se pierde (${perdidos} de ${casos} pierden algo${ejemplos.length ? `: ${ejemplos.join(' · ')}` : ''})`);
    if (!f.cuota) {
      ok(urisCambiadas === 0, `${f.nombre}: ninguna uri de memoria cambia (${urisCambiadas} de ${casos})`);
      ok(noExactos === 0, `${f.nombre}: 🔴 lo guardado es EXACTAMENTE memoria ∪ lo que agregó el import ∪ la nueva (${noExactos} de ${casos} no)`);
    } else {
      console.log(`    · F2, lo que no es exacto (informativo, no es un assert): ${noExactos} de ${casos}; de ellos ${revividos} reviven algo que esta pestaña quitó y no pudo guardar (lo mismo que haría recargar)`);
    }
  }
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
if (fallaron) console.log('fallaron:\n' + fallos.map((f) => '  · ' + f).join('\n'));
process.exit(fallaron ? 1 : 0);
