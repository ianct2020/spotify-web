// Playlists por estilo en Recomendaciones (v=369, tanda 132).
//
// Con artistas, etiquetas y temas INVENTADOS, sin red:
//   1. el módulo puro REAL (`util/recs-estilo.js`): los estilos de 2 o más y su orden, un artista en
//      dos estilos, los «sin estilo» contados por motivo, el autocorrect a otro artista que no cuenta,
//      el plan (6 artistas, 10 a 15 temas, el tope `temas + 3`), un artista con todo en me gusta, uno
//      con sin match, el error que PARA toda la lista (y no se cuenta como «sin match») y qué se guarda
//      y qué no de Last.fm (un 29, un 5xx, un 429 o un corte: nada) con 1.000 ms entre comienzos;
//   2. la resolución compartida REAL (`util/resolver-tema.js`) con `spotifyFetch` doblado: tres salidas;
//   3. la conservación de `getArtistTopTags` (`api/lastfm.js` REAL, `fetch` doblado);
//   4. el camino de UN artista (`recommendations.js` REAL) con un error en la búsqueda: hasta la tanda 140
//      afirmaba el defecto («sin match»); desde la 141 (v=378) afirma la tarjeta del corte y un «Sin match»
//      honesto (ver `tests/recs-un-artista-corte.test.mjs`).
//
// Los imports del código nuevo son dinámicos y con `catch`: contra ce8098a (donde no existe) el test
// corre igual y falla assert por assert, en vez de caerse al importar.

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

register('./dobles/loader-t132.mjs', pathToFileURL(import.meta.filename));
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => pathToFileURL(join(raiz, p)).href;

let bien = 0, mal = 0;
function ok(cond, nombre) { console.log(`  ${cond ? '✓' : '✗'} ${nombre}`); cond ? bien++ : mal++; }
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const avisos = [];
console.warn = (...a) => avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));

// localStorage de mentira (storage.js y lastfm.js lo leen).
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); },
  removeItem: (k) => { ls.delete(k); }, clear: () => ls.clear(), key: (i) => [...ls.keys()][i] ?? null, get length() { return ls.size; },
};

const E = await import(url('src/js/util/recs-estilo.js')).catch((e) => { console.log('  (no se pudo importar recs-estilo.js: ' + e.message + ')'); return null; });
const R = await import(url('src/js/util/resolver-tema.js')).catch((e) => { console.log('  (no se pudo importar resolver-tema.js: ' + e.message + ')'); return null; });
const fn = (m, n) => (m && typeof m[n] === 'function' ? m[n] : null);
// El `sha256` (normalizado) del HTML que pinta el camino de UN artista en el caso [7].
// Historia: en la tanda 132 era `HASH_PICK_CE8098A` = '4574f5fe902b9f00c2efd0f93fd2e2d438c7fcdc88a140458ec700eef2dc6e12',
// sacado contra ce8098a, y fijaba A PROPÓSITO el defecto de entonces (el 429 de «Tema Roto» pintado como «— sin match»).
// Desde la tanda 141 (v=378) el camino de un artista PARA en el primer error y lo dice con la tarjeta [data-recs-corte]:
// este es el HTML CON el corte, sacado corriendo este test contra el código de v=378. Si cambia, cambió lo que ve Ian.
const HASH_PICK_CORTE_T141 = '6b50012959ccf961805723ddb9d2f396ce681e60062329237195dcf7ca39666c';

// ── Un almacén inventado (la forma de `crearAlmacenGeneros`) ─────────────────
const T = (name, count = 100) => ({ name, count });
const reg = (nombre, tags, artista) => ({ uid: 'u', nombre: nombre.toLowerCase(), fuentes: { migrado: null, lastfm: { tags, fecha: 1, ...(artista !== undefined ? { artista } : {}) }, musicbrainz: null, statsfm: null } });
const almacen = (regs) => { const m = new Map(regs.map((r) => [r.nombre, r])); return (n) => m.get(String(n).toLowerCase()) ?? null; };

// ═══ 1. Los estilos ═════════════════════════════════════════════════════════
console.log('[1] agruparPorEstilo');
{
  const nombres = ['Niebla Uno', 'Doble Estilo', 'Cumbia Tres', 'Vals Solo', 'Sin Genero', 'Autocorregido', 'Fallo Lastfm', 'Nunca Pedido', 'Guion Hip', 'Espacio Hip', 'Niebla Once'];
  const registro = almacen([
    reg('Niebla Uno', [T('niebla pop')]),
    reg('Doble Estilo', [T('niebla pop'), T('cumbia lunar', 80)]),
    reg('Cumbia Tres', [T('cumbia lunar')]),
    reg('Vals Solo', [T('vals raro')]),
    reg('Sin Genero', [T('female vocalists'), T('british', 50)]),
    reg('Autocorregido', [T('niebla pop')], 'Otro Artista Distinto'),
    reg('Guion Hip', [T('hip-hop')]),
    reg('Espacio Hip', [T('hip hop')]),
    reg('Niebla Once', [T('niebla pop')]),
  ]);
  const agrupar = fn(E, 'agruparPorEstilo');
  const g = agrupar ? agrupar(nombres, registro, new Set(['Fallo Lastfm'])) : { estilos: [], cuentas: {} };
  ok(igual(g.estilos.map((e) => [e.estilo, e.artistas]), [
    ['niebla pop', ['Niebla Uno', 'Doble Estilo', 'Niebla Once']],
    ['cumbia lunar', ['Doble Estilo', 'Cumbia Tres']],
    ['hip hop', ['Guion Hip', 'Espacio Hip']],
  ]), `los estilos de 2 o más, por cuenta y a igualdad por nombre, con los artistas en el orden de la vista (${JSON.stringify(g.estilos.map((e) => e.estilo))})`);
  ok(g.estilos.filter((e) => e.artistas.includes('Doble Estilo')).length === 2, 'un artista con dos estilos aparece en los dos');
  ok(!g.estilos.some((e) => e.estilo === 'vals raro'), 'un estilo de un solo artista no se enseña');
  ok(!g.estilos.some((e) => e.artistas.includes('Autocorregido')), 'el autocorrect a OTRO artista no cuenta (sus etiquetas son de otro)');
  ok(igual(g.cuentas, { sinGenero: 1, noTiene: 1, sinBuscarFallo: 1, sinBuscarResto: 1, solos: 1 }), `los «sin estilo», contados por motivo (${JSON.stringify(g.cuentas)})`);
  const txt = fn(E, 'textoSinEstilo');
  ok(txt?.(g.cuentas) === '4 sin estilo: 1 sin etiquetas de género, 1 que Last.fm no tiene, 1 sin buscar (Last.fm no contestó), 1 sin buscar (paraste antes de llegar). 1 con un estilo que no comparte ningún otro recomendado.',
    `la línea de lo que no entró: «${txt?.(g.cuentas)}»`);
  ok(txt?.({ sinGenero: 0, noTiene: 0, sinBuscarFallo: 2, sinBuscarResto: 0, solos: 0 }) === '2 sin estilo: 2 sin buscar (Last.fm no contestó).', 'solo las partes que no son cero');
  ok(txt?.({ sinGenero: 0, noTiene: 0, sinBuscarFallo: 0, sinBuscarResto: 0, solos: 0 }) === '', 'si todo entró, ninguna línea');
  ok(E?.TEXTO_SIN_ESTILOS === 'Tus recomendados no comparten ningún estilo.', 'el texto de ningún estilo compartido');
  const fuente = E ? readFileSync(join(raiz, 'src/js/util/recs-estilo.js'), 'utf8') : '';
  ok(/import \{ generosDeArtista \} from '\.\/generos-regla\.js'/.test(fuente) && /from '\.\/generos-escaneo\.js'/.test(fuente)
    && !/NO_ES_GENERO|SINONIMOS|localeCompare|fetch\(|document\.|indexedDB/.test(fuente),
    'el módulo importa la regla (no la copia) y es puro: sin red, DOM ni IndexedDB');
}

// ═══ 2. El plan ═════════════════════════════════════════════════════════════
console.log('[2] planDeLista');
{
  const plan = fn(E, 'planDeLista');
  const ocho = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
  const p15 = plan?.(ocho, 15);
  ok(E?.ARTISTAS_POR_ESTILO === 6 && E?.TEMAS_MIN === 10 && E?.TEMAS_MAX === 15 && E?.TEMAS_DEFECTO === 12 && E?.BUSQUEDAS_DE_MAS === 3, 'las constantes: 6 artistas, de 10 a 15 temas (12 por defecto), +3 búsquedas');
  ok(igual(p15?.artistas, ocho.slice(0, 6)) && p15?.topePorArtista === 18 && p15?.topeTotal === 108, `con 8 artistas y 15 temas: los 6 primeros y 108 búsquedas como mucho (${p15?.topeTotal})`);
  ok(fn(E, 'textoCoste')?.(p15) === 'Hasta 108 búsquedas en Spotify.', 'la línea del costo');
  ok(plan?.(ocho, 9)?.temas === 10 && plan?.(ocho, 16)?.temas === 15 && plan?.(ocho, 'x')?.temas === 12, 'los temas se quedan entre 10 y 15 (y lo que no es un número, 12)');
  ok(/700/.test(E?.TITULO_COSTE || '') && /18\/09\/2026/.test(E?.TITULO_COSTE || ''), 'el `title` de la línea nombra por qué el tope (la cuota medida)');
}

// ═══ 3. armarLista ══════════════════════════════════════════════════════════
console.log('[3] armarLista');
{
  const armar = fn(E, 'armarLista');
  const plan = fn(E, 'planDeLista')?.(['Lleno', 'Todo Gusta', 'Sin Match', 'Lastfm Cae', 'Se Corta', 'Nunca'], 10);
  const temas = (a, n) => Array.from({ length: n }, (_, i) => ({ name: `${a} tema ${i + 1}`, artist: a }));
  const cand = { 'Lleno': temas('Lleno', 11), 'Todo Gusta': temas('Todo Gusta', 12), 'Sin Match': temas('Sin Match', 20), 'Se Corta': temas('Se Corta', 15), 'Nunca': temas('Nunca', 15) };
  const llamadas = [];
  const pausas = [];
  const ERROR = Object.assign(new Error('Spotify 429: inventado'), { status: 429 });
  const resolver = async (t) => {
    llamadas.push(t.name);
    if (t.artist === 'Sin Match' && +t.name.split(' ').pop() <= 5) return { estado: 'sin-match' };
    if (t.artist === 'Se Corta' && t.name.endsWith(' 2')) return { estado: 'error', error: ERROR };
    return { estado: 'encontrado', fila: { uri: `spotify:track:${t.name.replace(/\W/g, '')}`, trackId: t.name, name: t.name, matched: true } };
  };
  const r = armar && plan ? await armar({
    plan, resolver,
    topTracks: async (n) => { if (n === 'Lastfm Cae') throw new Error('Last.fm 29: inventado'); return cand[n]; },
    enMeGusta: (uri) => uri.startsWith('spotify:track:TodoGusta'),
    esperar: async (ms) => { pausas.push(ms); }, pausaMs: 120,
  }) : { artistas: [], corte: null, sinBuscar: [], busquedas: 0 };
  const a = (n) => r.artistas.find((x) => x.nombre === n) || {};
  const cab = (n) => fn(E, 'textoCabecera')?.(a(n), plan);
  ok(a('Lleno').temas?.length === 10 && a('Lleno').busquedas === 10 && cab('Lleno') === '10 de 10.', `un artista que llena: 10 de 10 y para de buscar (${a('Lleno').busquedas} búsquedas; «${cab('Lleno')}»)`);
  ok(a('Todo Gusta').temas?.length === 0 && a('Todo Gusta').yaGusta === 12 && cab('Todo Gusta') === '0 de 10: 12 ya en tus me gusta, Last.fm solo tiene 12 temas.', `uno con todo en me gusta: «${cab('Todo Gusta')}»`);
  ok(a('Sin Match').busquedas === 13 && a('Sin Match').sinMatch === 5 && a('Sin Match').temas?.length === 8 && cab('Sin Match') === '8 de 10: 5 sin match en Spotify, se llegó al tope de 13 búsquedas.', `uno con sin match, cortado por el tope de temas + 3: «${cab('Sin Match')}»`);
  ok(a('Lastfm Cae').lastfmFallo && a('Lastfm Cae').busquedas === 0 && /Last\.fm no contestó/.test(cab('Lastfm Cae') || ''), `si Last.fm no da los temas de uno, ese lo dice y la lista sigue: «${cab('Lastfm Cae')}»`);
  ok(r.corte?.tipo === 'error' && r.corte?.error === ERROR, 'un error de /search PARA toda la lista, con el error crudo');
  ok(a('Se Corta').busquedas === 2 && a('Se Corta').sinMatch === 0 && a('Se Corta').temas?.length === 1 && cab('Se Corta') === '1 de 10: la búsqueda se cortó aquí.', `el error NO se cuenta como «sin match»: «${cab('Se Corta')}»`);
  ok(llamadas.length === 37 && r.busquedas === 37 && r.corte?.busquedas === 37 && !llamadas.some((n) => n.startsWith('Nunca')), `ni una búsqueda después del error (${llamadas.length} búsquedas; ${llamadas.filter((n) => n.startsWith('Nunca')).length} de «Nunca»)`);
  ok(igual(r.sinBuscar, ['Nunca']), `los que no se llegaron a buscar, por nombre (${r.sinBuscar})`);
  ok(fn(E, 'textoCorte')?.(r.corte) === 'Spotify dejó de contestar después de 37 búsquedas: la lista está incompleta.', `el aviso: «${fn(E, 'textoCorte')?.(r.corte)}»`);
  ok(fn(E, 'textoSinBuscar')?.(r.sinBuscar) === 'Sin buscar: Nunca.', 'y la línea de los que no se buscaron');
  ok(pausas.length === 36 && pausas.every((ms) => ms === 120), `120 ms entre búsquedas (${pausas.length} pausas)`);
  ok(!!plan && r.artistas.every((x) => x.busquedas <= plan.topePorArtista) && r.busquedas <= plan.topeTotal, 'nunca más que el tope, por artista y en total');
  // «Parar» (o salir): igual que el error, pero «Paraste».
  let n = 0;
  const r2 = armar && plan ? await armar({ plan, resolver: async (t) => resolver(t), topTracks: async (x) => cand[x] || temas(x, 15), enMeGusta: () => false, seguir: () => ++n < 5 }) : {};
  ok(r2.corte?.tipo === 'parado' && fn(E, 'textoCorte')?.(r2.corte)?.startsWith('Paraste después de'), `«Parar» corta la lista y lo dice: «${r2.corte && fn(E, 'textoCorte')?.(r2.corte)}»`);
}

// ═══ 4. pedirEtiquetas ══════════════════════════════════════════════════════
console.log('[4] pedirEtiquetas: qué se guarda y qué no');
{
  const pedir = fn(E, 'pedirEtiquetas');
  const registro = almacen([reg('Ya Buscado', [T('niebla pop')])]);
  const RESP = {
    'Bien': { status: 200, datos: { toptags: { tag: [{ name: 'Rock Lunar', count: '100' }, { name: 'casi nada', count: '2' }], '@attr': { artist: 'Bien' } } } },
    'No Existe': { status: 200, datos: { error: 6, message: 'The artist you supplied could not be found' } },
    'Cuota': { status: 200, datos: { error: 29, message: 'inventado' } },
    'Cae': { status: 503, datos: null },
    'Corte': 'red',
    'Muchas': { status: 429, datos: null },
    'Vacio': { status: 200, datos: { toptags: { tag: [], '@attr': { artist: 'Vacío Oficial' } } } },
  };
  const nombres = ['Ya Buscado', ...Object.keys(RESP)];
  let t = 0;
  const comienzos = [];
  const guardados = [];
  const r = pedir ? await pedir({
    nombres, registro,
    pedir: async (n) => { comienzos.push([n, t]); t += 50; if (RESP[n] === 'red') throw new TypeError('Failed to fetch'); return RESP[n]; },
    guardar: async (n, tags, artista) => { guardados.push([n, tags, artista]); return true; },
    reloj: { ahora: () => t, esperar: async (ms) => { t += ms; } },
  }) : { pedidas: 0, guardados: [], noContesto: [] };
  ok(igual(comienzos.map((c) => c[0]), Object.keys(RESP)), `solo se pide lo que no está buscado, en orden (${comienzos.map((c) => c[0]).join(', ')})`);
  ok(comienzos.every((c, i) => i === 0 || c[1] - comienzos[i - 1][1] >= 1000), `1.000 ms como mínimo entre comienzos (${comienzos.map((c) => c[1]).join(', ')})`);
  ok(igual(guardados.map((g) => g[0]), ['Bien', 'No Existe', 'Vacio']), `se guarda la respuesta con toptags (aunque traiga 0) y el «no encontrado» (${guardados.map((g) => g[0]).join(', ')})`);
  ok(igual(guardados[0]?.[1], [{ name: 'rock lunar', count: 100 }]) && guardados[0]?.[2] === 'Bien', 'con el filtro de siempre y el nombre que devolvió Last.fm');
  ok(igual(guardados[1]?.[1], []) && guardados[1]?.[2] === undefined, 'el 6, como `[]` (sin nombre devuelto)');
  ok(guardados[2]?.[2] === 'Vacío Oficial', 'el nombre devuelto se guarda también con 0 etiquetas');
  ok(igual(r.noContesto?.map((x) => x.nombre), ['Cuota', 'Cae', 'Corte', 'Muchas']), `un 29, un 503, un corte y un 429: NADA guardado, quedan «sin buscar» (${r.noContesto?.map((x) => x.nombre)})`);
  ok(r.motivo === 'completo' && r.pedidas === 7 && r.total === 7, `sin reintentos: una petición por artista (${r.pedidas})`);

  // Un 10 (la key) para todo.
  const pedidos2 = [];
  const r2 = pedir ? await pedir({ nombres: ['K1', 'K2', 'K3'], registro: () => null, pedir: async (n) => { pedidos2.push(n); return n === 'K1' ? { status: 200, datos: { error: 10, message: 'Invalid API key' } } : RESP.Bien; }, guardar: async () => true, reloj: { ahora: () => 0, esperar: async () => {} } }) : {};
  ok(r2.motivo === 'key' && r2.codigo === 10 && pedidos2.length === 1, `un 10 para todo (${r2.motivo}, ${pedidos2.length} pedidas)`);
  // Salir (o «Parar») con una respuesta en vuelo: lo que llega SE GUARDA y no se pide la siguiente.
  let salir = false;
  const g3 = [];
  const r3 = pedir ? await pedir({ nombres: ['S1', 'S2'], registro: () => null, pedir: async () => { salir = true; return RESP.Bien; }, guardar: async (n) => { g3.push(n); return true; }, reloj: { ahora: () => 0, esperar: async () => {} }, seguir: () => !salir }) : {};
  ok(r3.motivo === 'parado' && r3.pedidas === 1 && igual(g3, ['S1']), `salir a mitad: lo que ya llegó queda guardado y no se pide el siguiente (${r3.motivo}, ${r3.pedidas}, ${g3})`);
  // Si la IndexedDB no escribe, se para.
  const r4 = pedir ? await pedir({ nombres: ['G1', 'G2'], registro: () => null, pedir: async () => RESP.Bien, guardar: async () => false, reloj: { ahora: () => 0, esperar: async () => {} } }) : {};
  ok(r4.motivo === 'no-guarda' && r4.pedidas === 1, 'si no se puede guardar, se para');
}

// ═══ 5. La resolución compartida ════════════════════════════════════════════
console.log('[5] resolverTemaEnSpotify');
const HIT = (name, artista, n = 1) => ({ uri: `spotify:track:inventado${n}`, id: `inventado${n}`, name, artists: [{ name: artista }], album: { name: 'Disco Inventado', id: 'albinventado', images: [{ url: 'https://example.invalid/grande.jpg' }, { url: 'https://example.invalid/chica.jpg' }] } });
globalThis.__T132 = { llamadas: [], likes: [], topTracks: async () => [], spotify: async () => ({ tracks: { items: [] } }) };
{
  const resolver = fn(R, 'resolverTemaEnSpotify');
  const S = globalThis.__T132;
  S.spotify = async (u) => {
    const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
    if (q.includes('Tema Bien')) return { tracks: { items: [HIT('Tema Bien (otra)', 'Otro'), HIT('Tema Bien', 'Banda Inventada', 2)] } };
    if (q.includes('Tema Sin')) return { tracks: { items: [HIT('Otra Cosa', 'Banda Inventada')] } };
    if (q.includes('Tema Nulo')) return null;
    throw Object.assign(new Error('Spotify 429: /search agotó su cuota (inventado)'), { status: 429 });
  };
  const bienR = resolver ? await resolver({ name: 'Tema Bien', artist: 'Banda Inventada' }) : null;
  ok(bienR?.estado === 'encontrado' && bienR.fila.uri === 'spotify:track:inventado2' && igual(Object.keys(bienR.fila), ['uri', 'trackId', 'name', 'artist', 'artistList', 'album', 'albumId', 'image', 'imageBig', 'matched'])
    && bienR.fila.image === 'https://example.invalid/chica.jpg' && bienR.fila.imageBig === 'https://example.invalid/grande.jpg', 'encontrado: el que verifica entre los 5 (no el primero), con la fila de siempre');
  ok((await resolver?.({ name: 'Tema Sin', artist: 'Banda Inventada' }))?.estado === 'sin-match', 'sin match: Spotify contestó y no está');
  const roto = await resolver?.({ name: 'Tema Roto', artist: 'Banda Inventada' });
  ok(roto?.estado === 'error' && roto.error?.status === 429, 'error: la búsqueda tiró (no es «sin match»)');
  ok((await resolver?.({ name: 'Tema Nulo', artist: 'Banda Inventada' }))?.estado === 'error', 'una respuesta ilegible (null) también es error');
  S.llamadas.length = 0;
  await resolver?.({ name: "Can't Inventado", artist: 'Banda Inventada' });
  await resolver?.({ name: 'Tema Bien', artist: 'Banda Inventada' }, { _maxRetries: 0 });
  ok(S.llamadas.length === 2 && S.llamadas[0].length === 1 && /limit=5/.test(S.llamadas[0][0]) && /type=track/.test(S.llamadas[0][0]) && !decodeURIComponent(S.llamadas[0][0]).includes("Can't"),
    'la query de siempre: limpiaParaQuery, type=track, limit=5, y sin opciones la llamada de siempre (un argumento)');
  ok(igual(S.llamadas[1]?.[1], { _maxRetries: 0 }), 'con opciones (el camino de un estilo), sin reintentos');
}

// ═══ 6. getArtistTopTags no cambió ══════════════════════════════════════════
console.log('[6] getArtistTopTags (conservación)');
{
  const L = await import(url('src/js/api/lastfm.js') + '?real=1');
  const pedidas = [];
  globalThis.fetch = async (u) => { pedidas.push(String(u)); return new Response(JSON.stringify({ toptags: { tag: [{ name: 'Niebla Pop', count: '100' }, { name: 'Casi', count: '4' }, { name: 'Vals', count: 5 }, { name: '', count: 100 }], '@attr': { artist: 'Otro Nombre' } } }), { status: 200 }); };
  const tags = await L.getArtistTopTags('Banda Inventada');
  ok(igual(tags, [{ name: 'niebla pop', count: 100 }, { name: 'vals', count: 5 }]), `devuelve lo mismo que en ce8098a: las etiquetas filtradas, sin el nombre devuelto (${JSON.stringify(tags)})`);
  ok(/method=artist\.gettoptags/.test(pedidas[0]) && /autocorrect=1/.test(pedidas[0]), 'con la misma consulta');
  const crudo = typeof L.pedirLastfmCrudo === 'function' ? await L.pedirLastfmCrudo('https://ws.audioscrobbler.com/2.0/?inventado=1') : null;
  ok(crudo?.status === 200 && crudo?.datos?.toptags?.['@attr']?.artist === 'Otro Nombre', 'pedirLastfmCrudo devuelve {status, datos} sin decidir nada');
  globalThis.fetch = async () => new Response('<html>503 inventado</html>', { status: 503 });
  const c503 = typeof L.pedirLastfmCrudo === 'function' ? await L.pedirLastfmCrudo('https://ws.audioscrobbler.com/2.0/?inventado=2') : null;
  ok(c503?.status === 503 && c503?.datos === null, 'un 503 que no es JSON: {status: 503, datos: null}, no tira');
  globalThis.fetch = async () => { throw new Error('red inventada'); };
}

// ═══ 7. El camino de UN artista no cambió ═══════════════════════════════════
console.log('[7] pickArtist (conservación)');
{
  const S = globalThis.__T132;
  S.llamadas.length = 0;
  S.topTracks = async (n) => [{ name: 'Tema Bien', artist: n }, { name: 'Tema Sin', artist: n }, { name: 'Tema Roto', artist: n }];
  S.spotify = async (u) => {
    const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
    if (q.includes('Tema Bien')) return { tracks: { items: [HIT('Tema Bien', 'Recomendado Inventado')] } };
    if (q.includes('Tema Sin')) return { tracks: { items: [] } };
    throw Object.assign(new Error('Spotify 429: /search agotó su cuota (inventado)'), { status: 429 });
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
  recs.render(elemento('contenedor'));
  await elemento('recs-run-btn').onclick();
  const pick = (elemento('recs-panel').__picks || [])[0];
  ok(!!pick, 'la vista pinta el recomendado (una tarjeta)');
  await pick?.onclick();
  const html = elemento('recs-tracks').innerHTML;
  const hash = createHash('sha256').update(html.replace(/\s+/g, ' ').trim()).digest('hex');
  console.log('  HTML de #recs-tracks, sha256 normalizado:', hash);
  const busquedas = S.llamadas.filter((a) => String(a[0]).startsWith('/search'));
  ok(busquedas.length === 3 && busquedas.every((a) => a.length === 1), `3 búsquedas, con la llamada de siempre (un argumento: los reintentos de siempre; Roto es la última, no hay nada que parar) (${busquedas.length})`);
  // Tanda 141: dado vuelta. Hasta v=377 afirmaba el defecto (1 nuevo, 2 sin match, la fila de Roto con «— sin match»).
  ok(/<div class="stat-value">1<\/div>\s*<div class="stat-label">Nuevos en Spotify/.test(html)
    && /<div class="stat-value" style="color:var\(--color-text-muted\)">1<\/div>\s*<div class="stat-label">Sin match/.test(html), 'el error ya NO cuenta como «sin match» (1 nuevo, 1 sin match: solo Tema Sin)');
  const grilla = html.split('<div class="tracks-grid">')[1] || '';
  ok((grilla.match(/— sin match/g) || []).length === 1 && !grilla.includes('Tema Roto'), 'una sola fila «— sin match» (Tema Sin) y ninguna de Tema Roto');
  ok(/data-recs-corte="error"/.test(html)
    && html.includes('<p class="recs-estilo-nota">Spotify dejó de contestar después de 3 búsquedas: la lista está incompleta.</p>')
    && html.includes('<p class="recs-estilo-crudo">Spotify 429: /search agotó su cuota (inventado)</p>')
    && html.includes('<p class="recs-estilo-nota" data-recs-sin-resolver>Sin resolver: Tema Roto.</p>'), 'la tarjeta [data-recs-corte] con el aviso, el 429 crudo y «Sin resolver: Tema Roto.»');
  ok(/data-uri="spotify:track:inventado1" checked/.test(grilla), 'lo encontrado (Tema Bien) sale tildado');
  ok(hash === HASH_PICK_CORTE_T141, `el HTML con el corte es el de la tanda 141 (${hash})`);
}

console.log(`${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
