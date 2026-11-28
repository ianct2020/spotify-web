// #recs: el camino de UN artista dice que Spotify no contestó en vez de «sin match» (v=378, tanda 141).
//
// `features/recommendations.js`, `util/recs-estilo.js` y `util/resolver-tema.js` REALES, con el loader y los
// dobles de la tanda 132 (`dobles/loader-t132.mjs`, `dobles/t132-doble.mjs`). Datos INVENTADOS, sin red.
//
//   A. corte a mitad (Bien → encontrado, Roto → tira un 429 de la pausa, Sin → no se busca);
//   B. el error es la primera búsqueda (y no sale «Todos los top tracks… ya están en tus likes»);
//   C. un 5xx agotado y un corte de red (un `Error` pelado, sin `status`): lo mismo que el 429;
//   D. sin ningún error, el HTML entero es el de c627756 (el `sha256` de abajo);
//   E. `textoSinResolver`, con uno y con tres nombres;
//   F. «Crear playlist» después de un corte: exactamente lo encontrado;
//   G. lecturas estáticas: las dos hojas y `resolver-tema.js` (sin comentarios) como en c627756, y sin
//      `_maxRetries` en `resolveTracksOnSpotify`.
//
// `RAIZ_T141` (por defecto, la raíz de este repo) corre el código de otra copia con ESTOS dobles: así se ve
// rojo contra c627756.

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

register('./dobles/loader-t132.mjs', pathToFileURL(import.meta.filename));
const RAIZ = resolve(process.env.RAIZ_T141 || join(dirname(fileURLToPath(import.meta.url)), '..'));
const url = (p) => pathToFileURL(join(RAIZ, p)).href;
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');
const sha = (x) => createHash('sha256').update(x).digest('hex');
console.log(`  raíz: ${RAIZ}`);

let bien = 0, mal = 0;
function ok(cond, nombre) { console.log(`  ${cond ? '✓' : '✗'} ${nombre}`); cond ? bien++ : mal++; }
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Constantes de c627756 ────────────────────────────────────────────────────
// El `sha256` normalizado (espacios aplanados) de `#recs-tracks` del caso D (Bien, Sin, Bien2, sin errores),
// sacado corriendo ESTE test con `RAIZ_T141` apuntando a un `git worktree` de c627756 (tanda 141).
const HASH_SIN_ERROR_C627756 = 'f32bf9375684b72765cfc225e7d2c00b15f988545d4b9f41cd75b78352664507';
// `sha256sum` de las dos hojas en c627756: esta tanda no toca ninguna.
const SHA_MAIN_CSS = '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07';
const SHA_COMPONENTS_CSS = '43018fe3dbdca7739c1d3a6295018d8b31edde51fa90c1fa3251be8f2430b645';
// El `sha256` de `util/resolver-tema.js` sin sus líneas de comentario ni las vacías, en c627756 (lo imprime
// este test): en esta tanda solo cambió su comentario de cabecera.
const SHA_RESOLVER_SIN_COMENTARIOS = '1b9ce462c86555eedf1d71431865c3f6c431388a385a523376022b5c2987a4ff';

// ── El entorno ───────────────────────────────────────────────────────────────
const avisos = [];
console.warn = (...a) => avisos.push(a);
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); },
  removeItem: (k) => { ls.delete(k); }, clear: () => ls.clear(), key: (i) => [...ls.keys()][i] ?? null, get length() { return ls.size; },
};
// Las pausas entre búsquedas: `sleep(120)` de `recommendations.js` es un `setTimeout` de 120 ms.
const PAUSA = 120;
let pausas = [];
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...r) => { if (ms === PAUSA) pausas.push(S().llamadas.length); return setTimeoutReal(f, ms, ...r); };

const HIT = (name, n) => ({ uri: `spotify:track:inventado${n}`, id: `inventado${n}`, name, artists: [{ name: 'Recomendado Inventado' }],
  album: { name: 'Disco Inventado', id: 'albinventado', images: [{ url: 'https://example.invalid/grande.jpg' }, { url: 'https://example.invalid/chica.jpg' }] } });
const ERR_429 = () => Object.assign(new Error('Spotify 429: /search en pausa hasta 2026-01-01T00:00:00.000Z (cuota agotada).'), { status: 429, searchEnPausa: true });
const ERR_5XX = () => new Error('Spotify 503: el servicio no responde después de 5 reintentos. Prueba de nuevo en un rato.');
const ERR_RED = () => new Error('No se pudo conectar con Spotify (Failed to fetch). Revisa tu conexión y vuelve a intentarlo.');
// Cada tema inventado y qué contesta la Spotify simulada.
const RESP = {
  'Tema Bien': () => ({ tracks: { items: [HIT('Tema Bien', 1)] } }),
  'Tema Bien Dos': () => ({ tracks: { items: [HIT('Tema Bien Dos', 2)] } }),
  'Tema Sin': () => ({ tracks: { items: [] } }),
  'Tema Roto': () => { throw ERR_429(); },
  'Tema Cinco': () => { throw ERR_5XX(); },
  'Tema Red': () => { throw ERR_RED(); },
};
globalThis.__T132 = { llamadas: [], likes: [], topTracks: async () => [], spotify: async () => ({ tracks: { items: [] } }) };
const S = () => globalThis.__T132;
S().spotify = async (u) => {
  const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
  const t = (q.match(/^track:"(.*?)" /) || [])[1];
  return RESP[t]();
};

const elementos = new Map();
const elemento = (id) => {
  if (!elementos.has(id)) {
    const el = {
      id, innerHTML: '', style: {}, textContent: '', onclick: null, disabled: false,
      addEventListener: () => {},
      querySelector: () => ({ textContent: '' }),
      querySelectorAll: (sel) => {
        if (sel !== '.art-card-pick') return [];
        return [...el.innerHTML.matchAll(/class="art-card-pick" data-idx="(\d+)"/g)].map((m) => ({ dataset: { idx: m[1] }, onclick: null }))
          .map((x) => { el.__picks = (el.__picks || []); el.__picks.push(x); return x; });
      },
    };
    elementos.set(id, el);
  }
  return elementos.get(id);
};
globalThis.document = { getElementById: elemento, querySelectorAll: () => [], addEventListener: () => {} };

const recs = await import(url('src/js/features/recommendations.js'));
const E = await import(url('src/js/util/recs-estilo.js')).catch(() => null);
recs.render(elemento('contenedor'));
await elemento('recs-run-btn').onclick();
const pick = (elemento('recs-panel').__picks || [])[0];
ok(!!pick, 'la vista pinta el recomendado (una tarjeta)');

// Toca el artista con estos temas de Last.fm y devuelve lo que se ve.
async function tocar(nombres) {
  S().llamadas.length = 0;
  pausas = [];
  avisos.length = 0;
  S().topTracks = async (n) => nombres.map((name) => ({ name, artist: n }));
  await pick?.onclick();
  const html = elemento('recs-tracks').innerHTML;
  const grilla = html.split('<div class="tracks-grid">')[1] || '';
  const stat = (etiqueta) => +((html.match(new RegExp(`>(\\d+)</div>\\s*<div class="stat-label">${etiqueta}`)) || [])[1] ?? NaN);
  const p = (re) => ((html.match(re) || [])[1] ?? null);
  return {
    html, grilla,
    hash: sha(html.replace(/\s+/g, ' ').trim()),
    busquedas: S().llamadas.filter((a) => String(a[0]).startsWith('/search')),
    pausas: [...pausas],
    nuevos: stat('Nuevos en Spotify'), sinMatch: stat('Sin match'),
    filasSinMatch: (grilla.match(/— sin match/g) || []).length,
    tarjeta: /<div class="card recs-estilo-corte" data-recs-corte="error">/.test(html),
    nota: p(/data-recs-corte="error">\s*<p class="recs-estilo-nota">([^<]*)<\/p>/),
    crudo: p(/<p class="recs-estilo-crudo">([^<]*)<\/p>/),
    sinResolver: p(/<p class="recs-estilo-nota" data-recs-sin-resolver>([^<]*)<\/p>/),
    todos: html.includes('Todos los top tracks de este artista ya están en tus likes'),
    tildado: (n) => new RegExp(`data-uri="spotify:track:inventado${n}" checked`).test(grilla),
    warn: avisos.filter((a) => String(a[0]).startsWith('[recs] Spotify dejó de contestar al resolver los temas de un artista')),
    antesDeTarjeta: html.indexOf('recs-estilo-corte') >= 0 && html.indexOf('recs-estilo-corte') < html.indexOf('results-summary'),
  };
}

// ═══ A. Corte a mitad ════════════════════════════════════════════════════════
console.log('[A] corte a mitad: Bien, Roto (429), Sin');
{
  const v = await tocar(['Tema Bien', 'Tema Roto', 'Tema Sin']);
  ok(v.busquedas.length === 2 && v.busquedas.every((a) => a.length === 1), `2 búsquedas, cada una con un solo argumento: los reintentos de siempre (${v.busquedas.length})`);
  ok(!v.busquedas.some((a) => decodeURIComponent(a[0]).includes('Tema Sin')), 'ninguna búsqueda después del error («Tema Sin» no se busca)');
  ok(igual(v.pausas, [1]), `una sola pausa, entre la 1.ª y la 2.ª; ninguna después del error (pausas tras las búsquedas nº ${JSON.stringify(v.pausas)})`);
  ok(v.sinMatch === 0 && v.nuevos === 1, `«Sin match» = 0 y «Nuevos» = 1 (${v.sinMatch}, ${v.nuevos})`);
  ok(!v.grilla.includes('Tema Roto') && !v.grilla.includes('Tema Sin') && v.filasSinMatch === 0, 'ninguna fila de Roto ni de Sin en la grilla');
  ok(v.tarjeta && v.antesDeTarjeta, 'la tarjeta [data-recs-corte="error"], arriba de las estadísticas');
  ok(v.nota === 'Spotify dejó de contestar después de 2 búsquedas: la lista está incompleta.', `el aviso: «${v.nota}»`);
  ok(v.crudo === ERR_429().message, `el error crudo: «${v.crudo}»`);
  ok(v.sinResolver === 'Sin resolver: Tema Roto, Tema Sin.', `los sin resolver: «${v.sinResolver}»`);
  ok(v.tildado(1), 'lo encontrado (Bien) sale tildado');
  ok(!v.todos, 'no sale «Todos los top tracks… ya están en tus likes»');
  ok(v.warn.length === 1 && v.warn[0][1]?.status === 429 && v.warn[0][1]?.searchEnPausa === true, `console.warn('[recs] …') con el error crudo (${v.warn.length})`);

  // ═══ F. Crear la playlist después del corte ═══════════════════════════════
  console.log('[F] «Crear playlist» después del corte');
  S().escrituras = [];
  S().nombrePlaylist = 'Lista inventada t141';
  await elemento('recs-create-btn').onclick?.();
  const esc = S().escrituras;
  ok(esc.length === 2 && esc[0][0] === 'createPlaylist' && esc[0][1] === 'Lista inventada t141', `1 playlist con el nombre confirmado (${JSON.stringify(esc.map((e) => e[0]))})`);
  ok(esc[1]?.[0] === 'addTracksToPlaylist' && esc[1]?.[1] === 'playlistinventadat141' && igual(esc[1]?.[2], ['spotify:track:inventado1']), `con exactamente lo encontrado (${JSON.stringify(esc[1]?.[2])})`);
  delete S().escrituras;
  delete S().nombrePlaylist;
}

// ═══ B. El error es la primera ═══════════════════════════════════════════════
console.log('[B] el error es la primera búsqueda');
{
  const v = await tocar(['Tema Roto', 'Tema Bien', 'Tema Sin']);
  ok(v.busquedas.length === 1 && v.pausas.length === 0, `1 búsqueda y ninguna pausa (${v.busquedas.length}, ${v.pausas.length})`);
  ok(!/pretty-check-row/.test(v.grilla) && v.nuevos === 0 && v.sinMatch === 0, `ninguna fila (Nuevos ${v.nuevos}, Sin match ${v.sinMatch})`);
  ok(v.tarjeta && v.nota === 'Spotify dejó de contestar después de 1 búsqueda: la lista está incompleta.', `la tarjeta: «${v.nota}»`);
  ok(v.sinResolver === 'Sin resolver: Tema Roto, Tema Bien, Tema Sin.', `«${v.sinResolver}»`);
  ok(!v.todos, 'y NO sale «Todos los top tracks de este artista ya están en tus likes»');
}

// ═══ C. Un 5xx agotado y un corte de red ═════════════════════════════════════
for (const [tema, err, que] of [['Tema Cinco', ERR_5XX(), 'un 5xx agotado'], ['Tema Red', ERR_RED(), 'un corte de red']]) {
  console.log(`[C] ${que} (un Error pelado, sin status)`);
  const v = await tocar(['Tema Bien', tema, 'Tema Sin']);
  ok(v.busquedas.length === 2 && igual(v.pausas, [1]), `${que}: 2 búsquedas, ninguna después (${v.busquedas.length})`);
  ok(v.sinMatch === 0 && v.filasSinMatch === 0 && !v.grilla.includes(tema), `${que}: «Sin match» = 0 y ninguna fila del que falló`);
  ok(v.tarjeta && v.nota === 'Spotify dejó de contestar después de 2 búsquedas: la lista está incompleta.' && v.crudo === err.message, `${que}: la tarjeta con el crudo («${v.crudo}»)`);
  ok(v.sinResolver === `Sin resolver: ${tema}, Tema Sin.` && v.tildado(1), `${que}: «${v.sinResolver}» y Bien tildado`);
  ok(v.warn.length === 1 && v.warn[0][1]?.message === err.message, `${que}: console.warn con el error crudo`);
}

// ═══ D. Sin ningún error, el HTML de c627756 ═════════════════════════════════
console.log('[D] sin errores: Bien, Sin, Bien Dos');
{
  const v = await tocar(['Tema Bien', 'Tema Sin', 'Tema Bien Dos']);
  console.log('  HTML de #recs-tracks sin errores, sha256 normalizado:', v.hash);
  ok(v.busquedas.length === 3 && v.pausas.length === 2, `3 búsquedas y 2 pausas, como siempre (${v.busquedas.length}, ${v.pausas.length})`);
  ok(!v.tarjeta && !/data-recs-corte/.test(v.html) && v.sinMatch === 1 && v.filasSinMatch === 1 && v.nuevos === 2, 'ninguna tarjeta; 2 nuevos y 1 sin match de verdad');
  ok(v.warn.length === 0, 'ningún console.warn');
  ok(v.hash === HASH_SIN_ERROR_C627756, `el HTML es byte a byte (con el espacio aplanado) el de c627756 (${v.hash})`);
  ok(v.html.startsWith('\n    <div class="results-summary">'), 'sin corte, ni un espacio de más al principio');
}

// ═══ E. textoSinResolver ═════════════════════════════════════════════════════
console.log('[E] textoSinResolver');
{
  const f = E && typeof E.textoSinResolver === 'function' ? E.textoSinResolver : null;
  ok(f?.(['Tema Uno']) === 'Sin resolver: Tema Uno.', `con uno: «${f?.(['Tema Uno'])}»`);
  ok(f?.(['Tema Uno', 'Tema Dos', 'Tema Tres']) === 'Sin resolver: Tema Uno, Tema Dos, Tema Tres.', `con tres: «${f?.(['Tema Uno', 'Tema Dos', 'Tema Tres'])}»`);
}

// ═══ G. Lecturas estáticas ═══════════════════════════════════════════════════
console.log('[G] lecturas estáticas');
{
  ok(sha(readFileSync(join(RAIZ, 'src/css/main.css'))) === SHA_MAIN_CSS, 'main.css es la de c627756');
  ok(sha(readFileSync(join(RAIZ, 'src/css/components.css'))) === SHA_COMPONENTS_CSS, 'components.css es la de c627756');
  const fuente = leer('src/js/features/recommendations.js');
  // Solo el código: el comentario del bucle nombra `_maxRetries` para decir que no se usa.
  const cuerpo = fuente.slice(fuente.indexOf('async function resolveTracksOnSpotify'), fuente.indexOf('\nfunction filaPorId'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(cuerpo.length > 100 && !cuerpo.includes('_maxRetries') && /resolverTemaEnSpotify\(t\)/.test(cuerpo), 'resolveTracksOnSpotify llama a resolverTemaEnSpotify(t) sin opciones y sin `_maxRetries`');
  const sinComentarios = leer('src/js/util/resolver-tema.js').split('\n')
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('/**') && !t.startsWith('*'); }).join('\n');
  const hr = sha(sinComentarios);
  console.log('  resolver-tema.js sin comentarios, sha256:', hr);
  ok(hr === SHA_RESOLVER_SIN_COMENTARIOS, `util/resolver-tema.js solo cambió en su comentario (${hr})`);
}

console.log(`${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
