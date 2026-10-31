// tests/reset-login.test.mjs — «Reset + Login» borra solo lo del login, como «Cerrar sesión» (v=348, tanda 105)
//
// POR QUÉ ESTA SUITE EXISTE: la pantalla «Error al conectar» de `app.js` tenía un botón «Reset + Login» con
// `onclick="localStorage.clear();location.reload()"`. Eso se llevaba TODO el `localStorage`: lo que no se puede rehacer
// (los «ya escuchados» de Descubrir, lo quitado de #listened, los grupos descartados de #versions, los géneros ocultos,
// los artistas elegidos, los registros de borrados…), y además `fonoteca_last_user_id` y la marca de los me gusta de
// otra cuenta, dejando la caché de me gusta en IndexedDB sin nada contra qué comparar. Desde v=348 el botón llama a
// `logout()` de `auth.js`, el mismo de «Cerrar sesión», que borra solo las cinco claves del login.
//
// 🔴 Lo que se prueba NO es «ya no se llama a clear»: es que LO QUE HABÍA SIGUE AHÍ, clave por clave y con su nombre.
// La lista de lo que tiene que sobrevivir sale del `CENSO` de `util/copia-completa.js` (clase 1 en `localStorage`) y,
// además, está escrita a mano acá: si el `CENSO` cambia, esto se pone rojo y alguien la mira.
//
// El botón de verdad: la plantilla y el código que lo conecta salen del FUENTE de `app.js` (el `catch` de la pantalla
// «Error al conectar»), con un DOM de mentira que hace lo que hace el navegador con un `onclick="…"` en línea (lo corre
// en el ámbito GLOBAL, donde no hay `import`), un `localStorage` de mentira y el `logout()` REAL. Todo INVENTADO.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
console.error = () => {};

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const lsMapa = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
let recargas = 0;
globalThis.location = { hash: '#home', reload: () => { recargas++; } };
globalThis.window = globalThis;

const UID = 't105-cuenta-a-inventada';
const UID_ANTERIOR = 't105-cuenta-b-inventada';

// Pela el JS: los comentarios en blanco (los strings y el texto de las plantillas quedan). Copiado de
// `tests/me-gusta-de-otra-cuenta.test.mjs` (`pelar`, la parte de `cod`): un lexer chico y no un `replace`.
function sinComentarios(src) {
  const n = src.length;
  let cod = '';
  const pila = [{ t: 'code', llaves: 0 }];
  let prevSig = '', prevPal = '';
  const blanco = (s) => s.replace(/[^\n]/g, ' ');
  const puedeRegex = () => !prevSig || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig) || /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(prevPal);
  let i = 0;
  while (i < n) {
    const top = pila[pila.length - 1];
    const c = src[i], d = src[i + 1];
    if (top.t === 'tpl') {
      if (c === '\\') { cod += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { pila.pop(); cod += c; i++; prevSig = '`'; prevPal = ''; continue; }
      if (c === '$' && d === '{') { pila.push({ t: 'code', llaves: 0 }); cod += '${'; i += 2; prevSig = '{'; prevPal = ''; continue; }
      cod += c; i++; continue;
    }
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; cod += blanco(src.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); const j = f < 0 ? n : f + 2; cod += blanco(src.slice(i, j)); i = j; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } cod += src.slice(i, j + 1); i = j + 1; prevSig = c; prevPal = ''; continue; }
    if (c === '`') { pila.push({ t: 'tpl' }); cod += c; i++; continue; }
    if (c === '/' && puedeRegex()) {
      let j = i + 1, clase = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') clase = true; else if (src[j] === ']') clase = false; else if (src[j] === '/' && !clase) break; j++; }
      j++; while (j < n && /[a-z]/i.test(src[j])) j++;
      cod += src.slice(i, j); i = j; prevSig = '/'; prevPal = ''; continue;
    }
    if (c === '{') top.llaves++;
    if (c === '}') { if (top.llaves === 0 && pila.length > 1) { pila.pop(); cod += c; i++; prevSig = '`'; continue; } top.llaves--; }
    cod += c;
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; prevPal = src.slice(i, j); cod += src.slice(i + 1, j); prevSig = 'a'; i = j; continue; }
    prevSig = c; prevPal = ''; i++;
  }
  return cod;
}
function jsDe(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsDe(p)); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ── a) Ningún `localStorage.clear(` en src/js, fuera de comentarios ──────────────────────────────
decir('· a) ningún localStorage.clear( en src/js (fuera de comentarios)');
{
  const hallados = [];
  for (const p of jsDe(join(raiz, 'src/js'))) {
    const cod = sinComentarios(readFileSync(p, 'utf8'));
    for (const m of cod.matchAll(/localStorage\s*\.\s*clear\s*\(/g)) hallados.push(`${relative(raiz, p)}:${cod.slice(0, m.index).split('\n').length}`);
  }
  ok(hallados.length === 0, `🔴 a) ningún localStorage.clear( en src/js (hallados: ${hallados.join(' · ') || '—'})`);
  const mutante = sinComentarios("// localStorage.clear()\n/* localStorage.clear() */ const x = 'https://a//b'; localStorage.clear();\n");
  ok([...mutante.matchAll(/localStorage\s*\.\s*clear\s*\(/g)].length === 1, 'a) la guarda ve un clear( de código y no los de los comentarios (mutante)');
}

// ── La pantalla «Error al conectar», sacada del fuente ───────────────────────────────────────────
const appSrc = readFileSync(join(raiz, 'src/js/app.js'), 'utf8');
/** El cuerpo del `catch` que pinta «Error al conectar». */
function cuerpoDelCatch() {
  const iTitulo = appSrc.indexOf('Error al conectar</h2>');
  if (iTitulo < 0) return null;
  const iCatch = appSrc.lastIndexOf('catch (e) {', iTitulo);
  if (iCatch < 0) return null;
  const ini = iCatch + 'catch (e) {'.length;
  let prof = 1, i = ini;
  for (; i < appSrc.length && prof; i++) { if (appSrc[i] === '{') prof++; else if (appSrc[i] === '}') prof--; }
  return appSrc.slice(ini, i - 1);
}
const cuerpo = cuerpoDelCatch();

/** Los `<button …>texto</button>` de un HTML, con sus atributos. */
function botonesDe(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return { attrs, texto: m[2].replace(/<[^>]+>/g, '').trim() };
  });
}

// ── b) La plantilla: el botón sin `onclick` en línea, y el código que lo conecta llama a logout ──
decir('· b) el botón «Reset + Login» de la plantilla, sin onclick en línea, conectado a logout');
{
  ok(!!cuerpo, 'b) el catch de «Error al conectar» está en app.js');
  const plantilla = /innerHTML\s*=\s*`([\s\S]*?)`/.exec(cuerpo || '')?.[1] ?? '';
  const boton = botonesDe(plantilla).find((b) => b.texto === 'Reset + Login');
  ok(!!boton, 'b) el botón «Reset + Login» sigue en la plantilla, con el mismo texto');
  ok(boton && !('onclick' in boton.attrs), `🔴 b) el botón no lleva onclick en línea (lleva: ${boton?.attrs.onclick ?? '—'})`);
  const id = boton?.attrs.id;
  ok(!!id, `🔴 b) el botón tiene id para conectarlo (${id ?? 'sin id'})`);
  const iCon = id ? (cuerpo || '').search(new RegExp(`getElementById\\(\\s*['"]${id}['"]\\s*\\)`)) : -1;
  const conexion = iCon >= 0 ? cuerpo.slice(iCon, cuerpo.indexOf(';', iCon) + 1) : '';
  ok(/\blogout\b/.test(conexion), `🔴 b) el código que lo conecta llama a logout (${conexion.trim() || 'no hay código que lo conecte'})`);
  ok(conexion && !/clear/.test(conexion), 'b) el código que lo conecta no contiene clear');
}

// ── c) Lo que tiene que sobrevivir, del CENSO ───────────────────────────────────────────────────
decir('· c) la lista de lo que tiene que sobrevivir sale del CENSO (clase 1 en localStorage)');
const { CENSO } = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
const CLASE1_LS = CENSO.filter((c) => c.clase === 1 && c.donde === 'ls');
// 🔴 Escrita a mano: lo que dice el CENSO hoy. El encargo de la tanda 105 esperaba además `ocultos_sin_uri_v1`, que en
// el CENSO es clase 3 (va con los ocultos con playlist espejo): igual se siembra y se mira abajo, como una de las «de más».
const ESPERADAS = [
  'discover_escuchados', 'discover_escuchados_uris', 'listened_unreg_dismissed', 'listened_dupes_dismissed',
  'listened_history_dismissed', 'versions_dismissed', 'genre_hidden_tags', 'discoverart_elegidos', 'newrel_elegidos',
  'likes_borrados_log_v1', 'versions_supervivientes_perdidas_v1',
];
{
  const delCenso = CLASE1_LS.map((c) => c.clave);
  ok(JSON.stringify(delCenso) === JSON.stringify(ESPERADAS), `c) el CENSO dice estas ${delCenso.length} de clase 1 en localStorage, en este orden (${delCenso.join(', ')})`);
  ok(CLASE1_LS.every((c) => !c.prefijo), 'c) ninguna es un prefijo (se siembran por su nombre)');
  ok(CENSO.filter((c) => c.clase === 1 && c.donde !== 'ls').length === 0, 'c) ninguna fila de clase 1 vive fuera de localStorage');
}

// ── El sembrado de d) y e) ──────────────────────────────────────────────────────────────────────
const authSrc = readFileSync(join(raiz, 'src/js/auth.js'), 'utf8');
// Las cuatro de `AUTH` (las `*_KEY`) con los nombres que dice `auth.js`, más `sp_granted_scopes`.
const CLAVES_LOGIN = [...new Set([...authSrc.matchAll(/\b[A-Z]+_KEY:\s*'([^']+)'/g)].map((m) => m[1]).concat('sp_granted_scopes'))];
// Cada clave de c), pelada y con `prefKey()` (todas son `porUsuario: 'pref'`), con un valor inventado distinto.
const SOBREVIVEN = CLASE1_LS.flatMap((c) => (c.porUsuario === 'pref' ? [c.clave, `${c.clave}__${UID}`] : [c.clave]));
const DE_MAS = ['fonoteca_theme_v1__' + UID, 'fonoteca_hidden_pl_wthree_hidden_albums__' + UID, 'ocultos_sin_uri_v1', 'ocultos_sin_uri_v1__' + UID];
function sembrar() {
  lsMapa.clear();
  recargas = 0;
  globalThis.location.hash = '#home';
  for (const k of CLAVES_LOGIN) lsMapa.set(k, `t105-login-inventado-${k}`);
  lsMapa.set('fonoteca_last_user_id', UID);
  lsMapa.set('fonoteca_likes_de_otro_v1', UID_ANTERIOR);
  SOBREVIVEN.forEach((k, i) => lsMapa.set(k, JSON.stringify([`t105-valor-inventado-${i}`, k])));
  DE_MAS.forEach((k, i) => lsMapa.set(k, `t105-de-mas-${i}`));
  return new Map(lsMapa);
}
function afirmarConservado(antes, quien) {
  ok(CLAVES_LOGIN.length === 5, `${quien}: las cinco del login salen de auth.js (${CLAVES_LOGIN.join(', ')})`);
  for (const k of CLAVES_LOGIN) ok(!lsMapa.has(k), `${quien}: la del login «${k}» no está`);
  const fallan = [];
  for (const k of SOBREVIVEN) {
    const sigue = lsMapa.get(k) === antes.get(k);
    if (!sigue) fallan.push(k);
    ok(sigue, `🔴 ${quien}: «${k}» sigue, con el mismo valor byte a byte`);
  }
  ok(lsMapa.get('fonoteca_last_user_id') === UID, `🔴 ${quien}: fonoteca_last_user_id sigue igual`);
  ok(lsMapa.get('fonoteca_likes_de_otro_v1') === UID_ANTERIOR, `🔴 ${quien}: la marca fonoteca_likes_de_otro_v1 sigue igual`);
  for (const k of DE_MAS) ok(lsMapa.get(k) === antes.get(k), `${quien}: la de más «${k}» sigue igual`);
  ok(recargas === 1, `${quien}: reload se llamó una vez (${recargas})`);
  return fallan;
}

// Un DOM de mentira: el `innerHTML` de #app arma los botones de la plantilla. Un `onclick="…"` en línea se compila en
// el ámbito GLOBAL (como en el navegador: ve `localStorage` y `location`, no ve los `import` del módulo) y queda en la
// propiedad `onclick`, que el código del módulo puede pisar.
function domDeMentira() {
  const porId = new Map();
  const botones = [];
  const hacerBoton = (attrs, texto) => {
    const el = { attrs, texto, listeners: [], onclick: null };
    if (attrs.onclick) el.onclick = new Function('event', attrs.onclick);
    el.addEventListener = (tipo, f) => { if (tipo === 'click') el.listeners.push(f); };
    el.click = () => { const ev = { type: 'click', target: el, preventDefault() {} }; if (typeof el.onclick === 'function') el.onclick.call(el, ev); for (const f of el.listeners) f.call(el, ev); };
    if (attrs.id) porId.set(attrs.id, el);
    botones.push(el);
    return el;
  };
  const app = { set innerHTML(html) { for (const b of botonesDe(html)) hacerBoton(b.attrs, b.texto); }, get innerHTML() { return ''; } };
  porId.set('app', app);
  return { document: { getElementById: (id) => porId.get(id) ?? null }, botones, hacerBoton };
}

const { logout } = await import(pathToFileURL(join(raiz, 'src/js/auth.js')).href);

// ── d) El botón de verdad ───────────────────────────────────────────────────────────────────────
decir('· d) «Reset + Login» de verdad: se arma la pantalla, se conecta como en app.js y se le hace clic');
{
  const antes = sembrar();
  const dom = domDeMentira();
  let corrio = true;
  try {
    new Function('e', 'document', 'logout', 'console', cuerpo)(new Error('Spotify 500: inventado'), dom.document, logout, { error() {}, warn() {}, log() {} });
  } catch (err) { corrio = false; decir(`    (el catch tiró: ${err.message})`); }
  ok(corrio, 'd) el catch de «Error al conectar» corre con el DOM de mentira');
  const boton = dom.botones.find((b) => b.texto === 'Reset + Login');
  ok(!!boton, 'd) la pantalla tiene el botón «Reset + Login»');
  let tiro = null;
  try { boton?.click(); } catch (err) { tiro = err; }
  ok(!tiro, `d) el clic no tira (${tiro?.message ?? 'no tiró'})`);
  const fallan = afirmarConservado(antes, 'd) Reset + Login');
  decir(`    d) claves de c) que NO sobrevivieron: ${fallan.length} de ${SOBREVIVEN.length}${fallan.length ? ` → ${fallan.join(', ')}` : ''}`);
}

// ── e) «Cerrar sesión» del menú, de conservación ────────────────────────────────────────────────
decir('· e) «Cerrar sesión» del menú (conservación)');
{
  const antes = sembrar();
  const dom = domDeMentira();
  const linea = /document\.getElementById\(\s*'logout-btn'\s*\)[^;]*;/.exec(appSrc)?.[0];
  ok(!!linea && /\blogout\b/.test(linea), `e) app.js conecta #logout-btn a logout (${linea ?? 'no está'})`);
  dom.hacerBoton({ id: 'logout-btn' }, 'Cerrar sesión');
  new Function('document', 'logout', linea || '')(dom.document, logout);
  dom.document.getElementById('logout-btn').click();
  afirmarConservado(antes, 'e) Cerrar sesión');
}

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
