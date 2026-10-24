// Los datos y las herramientas del banco `copia-importar` (v=334, tanda 79). TODO INVENTADO: el repo es público.
//
// Lo que hay acá:
//   · el almacenamiento del origen del banco, a mano (sin la app): sembrar, leer, vaciar y fotografiar (sha256);
//   · los perfiles: A (TODAS las filas del censo que entran, con las 11 irrecuperables y `ocultos_sin_uri_v1`, con
//     `prefKey`; `tamano: 'ian'` le da el tamaño de los datos de Ian, como el banco de la 78) y C (un estado PROPIO,
//     con conjuntos, mapas, registros y una discografía distintos de los de A);
//   · la Spotify simulada de `#skips`: la playlist de ocultos «fonoteca · ocultos (skips)», con su estado en la MADRE
//     (cada carga de página es un iframe nuevo; una playlist que renaciera en cada carga no probaría nada);
//   · el ORÁCULO de las uniones: qué tiene que quedar en cada clave de C, calculado aparte, sin `copia-importar.js`.
//
// ⚠️ Cada caso vacía el almacenamiento del origen del banco antes de sembrar: es el perfil temporal de Chrome del banco
// (`/tmp/banco-chrome-*`, que `correr-banco.mjs` crea y borra), nunca el de nadie. Así A, B, C… son perfiles distintos
// dentro de la misma corrida.

export const UID = 't79-banco-uid';
export const OTRO = 't79-banco-otro';
export const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';   // HISTORY_OWNER_ID: solo en el caso E, contra la Spotify simulada
export const PL_SKIPS = 'plOcultosSkipsBanco000';
export const PL_DE_A = 'plOcultosSkipsDeA00000';      // el id que trae el archivo de A: no existe en la simulada

const L = (n, f) => Array.from({ length: n }, (_, i) => f(i));
export const id22 = (i, p = 'x') => (p + String(i).padStart(21, '0')).slice(0, 22);
export const envolver = (value, storedAt = 1_760_000_000_000) => ({ value, storedAt, expiry: null });
const J = JSON.stringify;

// ── El almacenamiento a mano ───────────────────────────────────────────────────────────────────────
function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('spotify-tools', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function enTx(modo, fn) {
  const db = await abrir();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction('kv', modo); const s = t.objectStore('kv');
      const out = fn(s);
      t.oncomplete = () => res(typeof out === 'function' ? out() : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  } finally { db.close(); }
}
export const sembrarIdb = (pares) => enTx('readwrite', (s) => { for (const [k, v] of pares) s.put(v, k); });
export const vaciarIdb = () => enTx('readwrite', (s) => { s.clear(); });
export async function leerIdb() {
  return enTx('readonly', (s) => { const k = s.getAllKeys(), v = s.getAll(); return () => k.result.map((x, i) => [x, v.result[i]]); });
}
export function leerLs() {
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort().map((k) => [k, localStorage.getItem(k)]);
}
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha(texto) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))); }

// ── La Spotify simulada para `#skips` (y el `/me` de cada caso) ────────────────────────────────────
export function crearEstado() {
  // Lo que «la otra compu» ya subió a la playlist de ocultos de #skips: los ocultos PROPIOS de C.
  return { playlists: { [PL_SKIPS]: { id: PL_SKIPS, name: 'fonoteca · ocultos (skips)', owner: { id: UID }, escrituras: 0, items: ocultosDeC().map(pistaOculta) } }, posts: [] };
}
const pistaOculta = (id) => ({ id, uri: `spotify:track:${id}`, name: `Pista oculta ${id.slice(-3)}`, type: 'track', artists: [{ id: id22(1, 'a'), name: 'Artista inventado' }], album: { id: id22(1, 'b'), name: 'Disco inventado', images: [] } });

export function montarSpotify(sim, estado, uid) {
  sim.ruta('GET', /^\/me$/, () => ({ id: uid, display_name: 'Banco' }));
  sim.ruta('GET', /^\/me\/tracks/, () => ({ items: [], total: 0, next: null }));
  sim.ruta('GET', /^\/me\/playlists/, () => ({ items: Object.values(estado.playlists).map((p) => ({ id: p.id, name: p.name, owner: p.owner, snapshot_id: 's' + p.escrituras, items: { total: p.items.length } })), total: Object.keys(estado.playlists).length, next: null }));
  sim.ruta('GET', /^\/playlists\/[^/?]+\?/, ({ ruta }) => {
    const p = estado.playlists[ruta.split('?')[0].split('/')[2]];
    return p ? { id: p.id, name: p.name, owner: p.owner, snapshot_id: 's' + p.escrituras } : sim.sinSimular(404);
  });
  sim.ruta('GET', /^\/playlists\/[^/?]+$/, ({ ruta }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    return p ? { id: p.id, name: p.name, owner: p.owner, snapshot_id: 's' + p.escrituras } : sim.sinSimular(404);
  });
  sim.ruta('GET', /^\/playlists\/[^/]+\/items/, ({ ruta, url }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    if (!p) return sim.sinSimular(404);
    const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 100;
    return { items: p.items.slice(off, off + lim).map((t) => ({ added_at: '2026-01-01T00:00:00Z', item: t })), total: p.items.length, offset: off, limit: lim, next: off + lim < p.items.length ? 'x' : null };
  });
  sim.ruta('POST', /^\/playlists\/[^/]+\/items/, ({ ruta, cuerpo }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    if (!p) return sim.sinSimular(404);
    const uris = cuerpo?.uris || [];
    estado.posts.push({ playlist: p.id, uris: [...uris] });
    for (const u of uris) p.items.push(pistaOculta(u.split(':').pop()));
    p.escrituras++;
    return { snapshot_id: 's' + p.escrituras };
  });
}

// ── H2, la otra pestaña que oculta DESPUÉS del aviso (tanda 82) ─────────────────────────────────────
// Su propia playlist de ocultos de #skips (vacía al empezar: así lo que trae la copia de A no está ya en la memoria de H2
// por la playlist, que en la corrida entera tiene lo que subió C2), un me gusta INVENTADO que salteaste 9 veces de 10 y su
// historial de saltos (el BYOH de un amigo, `local_<uid>_history_skip`, formato v4), para que #skips tenga UNA tarjeta con
// su botón de ocultar.
export const PL_SKIPS_H2 = 'plOcultosSkipsH2000000';
export const SALTEADA_H2 = id22(50, 's');
export function perfilH2() {
  const pista = { id: SALTEADA_H2, uri: `spotify:track:${SALTEADA_H2}`, name: 'Tema inventado que salteas', artists: [{ id: id22(50, 'a'), name: 'Artista inventado de H2' }], album: { id: id22(50, 'b'), name: 'Disco inventado de H2', images: [] }, duration_ms: 200_000 };
  return {
    idb: [
      ['all_liked_tracks', envolver([pista])],
      [`local_${UID}_history_skip`, envolver({ version: 4, tracks: { [SALTEADA_H2]: [1, 9, L(9, () => 5_000), [], undefined] } })],
    ],
    ls: [[`fonoteca_hidden_pl_skips_hidden_tracks__${UID}`, PL_SKIPS_H2]],
  };
}

// ── El perfil A: una clave por fila del censo que entra ────────────────────────────────────────────
// Los ocultos de #skips de A: dos que C también tiene (ya en la playlist) y tres que C no tiene.
export const ocultosDeC = () => [id22(1, 'h'), id22(2, 'h'), id22(3, 'h')];
export const ocultosDeA = () => [id22(2, 'h'), id22(3, 'h'), id22(11, 'h'), id22(12, 'h'), id22(13, 'h')];
const TIPOS_HISTORIAL = ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks', 'days'];
const lanzamiento = (a, j) => ({ id: id22(a * 100 + j, 'r'), name: `Lanzamiento inventado ${j}`, album_type: j % 3 ? 'single' : 'album', release_date: `20${10 + (j % 15)}-01-01`, total_tracks: 1 + (j % 14), images: [{ url: `https://i.scdn.co/image/ab67616d00004851${'1'.repeat(24)}${String(a * 100 + j).padStart(16, '0')}`, height: 64, width: 64 }], artists: [{ id: id22(a, 'a'), name: `Artista inventado ${a}` }] });
export const baseDisco = (items, extra = {}) => ({ v: 1, items, fuente: 'nativo', cortada: false, estimada: false, completaAt: 1_760_000_000_000, recienteAt: 1_760_000_000_000, historial: [{ t: 1_760_000_000_000, via: 'nativo', n: items.length, nuevos: items.length }], ...extra });
const registro = (n, desde, extra = {}) => L(n, (i) => ({ fecha: new Date(Date.UTC(2026, 8, desde + i)).toISOString(), inventado: `${desde}-${i}`, ...extra })).reverse();
const etiqueta = (uid, n) => ({ uid, nombre: n, fuentes: { migrado: null, lastfm: { tags: L(5, (j) => ({ name: `género inventado ${j}`, count: 100 - j * 10 })), fecha: 1_760_000_000_000 }, musicbrainz: { tags: [{ name: 'rock inventado', count: 3 }], fecha: 1_760_000_100_000 }, statsfm: null } });

export function perfilA(C, { ian = false } = {}) {
  const idb = [], ls = [];
  const conj = { skips_hidden_tracks: ocultosDeA() };
  for (const c of C.CENSO) {
    if (!c.entra || (c.donde !== 'idb' && c.donde !== 'ls')) continue;
    if (c.donde === 'ls') {
      const k = c.porUsuario === 'pref' ? `${c.clave}__${UID}` : c.clave;
      let v;
      if (c.fusion === 'conjunto') v = J(conj[c.clave] || L(4, (i) => `${c.clave} de A ${i}`));
      else if (c.fusion === 'mapa') v = J(c.clave === 'skips_hidden_tracks_uris' ? Object.fromEntries(ocultosDeA().map((id) => [id, `spotify:track:${id}`])) : Object.fromEntries(L(3, (i) => [`clave de A ${i}`, `spotify:track:${id22(i, 'u')}`])));
      else if (c.fusion === 'registro') v = J(registro(4, 10));
      else if (c.clave.startsWith('fonoteca_hidden_pl_')) v = c.clave === 'fonoteca_hidden_pl_skips_hidden_tracks' ? PL_DE_A : id22(c.clave.length, 'p');
      else if (c.clave === 'ocultos_sin_uri_v1') v = J({ 'recs_ocultos::artista inventado': { desde: 1_760_000_000_000, intentos: 2, ultimoIntento: 1_760_000_100_000 } });
      else if (c.clave === 'lastfm_artist_tags_cache') v = J({ 'artista inventado': { tags: [{ name: 'género inventado', count: 50 }], at: 1_750_000_000_000 } });
      else v = J({ preferenciaInventadaDeA: c.clave });
      ls.push([k, v]);
    } else if (c.clave === 'local_') {
      for (const t of TIPOS_HISTORIAL) idb.push([`local_${UID}_history_${t}`, envolver({ inventadoDeA: t })]);
    } else {
      let k, v;
      if (c.fusion === 'discografia') { k = `${c.clave}${id22(1, 'a')}`; v = envolver(baseDisco(L(6, (j) => lanzamiento(1, j)))); }
      else if (c.clave === 'mosaico_colores_v1') { k = c.clave; v = envolver({ formato: 1, rejilla: '3x3', lado: 64, ids: L(6, (i) => id22(i, 'c')), host: Uint8Array.from([0, 1, 2, 0, 1, 2]), datos: Uint8Array.from(L(162, (i) => (i * 37) % 256)), fallidas: 0 }); }
      else if (c.porUsuario === 'clave') { k = c.deUsuario(UID) + 'artista inventado 1'; v = c.clave.startsWith('generos') ? etiqueta(UID, 'artista inventado 1') : envolver({ uid: UID, nombre: 'artista inventado 1', estado: 'ok', pais: 'XX' }); }
      else if (c.clave === 'generos_artista_migrado_v1') { k = c.clave; v = { uid: UID, fecha: 1_760_000_000_000, entradas: 1 }; }
      else { k = c.prefijo ? `${c.clave}area-1` : c.clave; v = envolver({ inventadoDeA: k }); }
      idb.push([k, v]);
    }
  }
  if (ian) agregarTamanoIan(idb, ls);
  return { idb, ls };
}

// El tamaño de los datos de Ian (los números de la 78, INVENTADOS): 351 discografías de 35, 2.302 artistas en el mapa y
// en géneros, 150 áreas, 1.950 días de detalle, 5.715 tapas, los seis almacenes de ocultos y 200 en cuatro irrecuperables.
function agregarTamanoIan(idb, ls) {
  const fuera = (k) => { for (const arr of [idb, ls]) { const i = arr.findIndex(([x]) => x === k); if (i >= 0) arr.splice(i, 1); } };
  // Los 9.548 me gusta: no entran al import (se vuelven a bajar de Spotify), pero el archivo los lleva en `likes` y el
  // import los parsea igual. La forma, la del banco de la 78.
  const like = (i) => ({ added_at: `2024-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, track: { id: id22(i, 't'), uri: `spotify:track:${id22(i, 't')}`, name: `Tema inventado número ${i}`, popularity: null, duration_ms: 180000 + (i % 90000), explicit: i % 7 === 0, is_playable: true, track_number: 1 + (i % 12), external_ids: { isrc: `XX${String(i).padStart(10, '0')}` }, artists: [{ id: id22(i % 2302, 'a'), name: `Artista inventado ${i % 2302}` }], album: { id: id22(i % 4000, 'b'), name: `Disco inventado ${i % 4000}`, release_date: '2019-05-17', album_type: 'album', total_tracks: 12, images: [{ url: `https://i.scdn.co/image/ab67616d00001e02${'0'.repeat(24)}${String(i).padStart(16, '0')}`, height: 300, width: 300 }, { url: `https://i.scdn.co/image/ab67616d00004851${'0'.repeat(24)}${String(i).padStart(16, '0')}`, height: 64, width: 64 }] } } });
  idb.push(['all_liked_tracks', envolver(L(9548, like))]);
  for (let a = 0; a < 351; a++) idb.push([`discover_disco_base_v1_${id22(a, 'a')}`, envolver(baseDisco(L(35, (j) => lanzamiento(a, j))))]);
  for (let a = 0; a < 2302; a++) {
    idb.push([`mapa_artista_v1_${UID}_artista inventado ${a}`, envolver({ uid: UID, nombre: `artista inventado ${a}`, estado: 'ok', mbid: `${String(a).padStart(8, '0')}-0000-4000-8000-000000000000`, area: `area-${a % 150}`, pais: 'XX', fecha: 1_760_000_000_000 })]);
    idb.push([`generos_artista_v1_${UID}_artista inventado ${a}`, etiqueta(UID, `artista inventado ${a}`)]);
  }
  for (let i = 0; i < 150; i++) idb.push([`mapa_area_v1_area-${i}`, envolver({ id: `area-${i}`, nombre: `Área inventada ${i}`, pais: 'XX', tipo: 'City', padre: null })]);
  const nT = 5715;
  fuera('mosaico_colores_v1');
  idb.push(['mosaico_colores_v1', envolver({ formato: 1, rejilla: '3x3', lado: 64, ids: L(nT, (i) => id22(i, 'c')), host: Uint8Array.from(L(nT, (i) => i % 3)), datos: Uint8Array.from(L(nT * 27, (i) => (i * 37) % 256)), fallidas: 0 })]);
  const temas = L(46260, (i) => [`Tema inventado ${i}`, `Artista inventado ${i % 2302}`, id22(i, 't')]);
  const dias = {};
  for (let d = 0; d < 1950; d++) { const f = new Date(Date.UTC(2018, 0, 1 + d)).toISOString().slice(0, 10); dias[f] = L(d < 1000 ? 52 : 51, (j) => [(d * 53 + j) % 46260, 30000 + ((j * 977) % 200000), 1 + (j % 3)]); }
  fuera(`local_${UID}_history_days`);
  idb.push([`local_${UID}_history_days`, envolver({ version: 1, temas, dias })]);
  const ocultos = { wthree_hidden_albums: 1400, discover_ocultos: 900, recs_ocultos: 12, skips_hidden_tracks: 500, zeroplays_hidden_tracks: 500, sin_clasificar_ocultas: 500 };
  for (const [k, n] of Object.entries(ocultos)) {
    const claves = L(n, (i) => (k === 'wthree_hidden_albums' || k === 'discover_ocultos' ? `disco inventado ${i}||artista inventado ${i % 300}` : id22(i, 'h')));
    fuera(`${k}__${UID}`); fuera(`${k}_uris__${UID}`);
    ls.push([`${k}__${UID}`, J(claves)], [`${k}_uris__${UID}`, J(Object.fromEntries(claves.map((c, i) => [c, `spotify:track:${id22(i, 'u')}`])))]);
  }
  for (const k of ['discover_escuchados', 'listened_unreg_dismissed', 'listened_history_dismissed', 'versions_dismissed']) { fuera(`${k}__${UID}`); ls.push([`${k}__${UID}`, J(L(200, (i) => `disco inventado ${i}||artista inventado ${i % 300}`))]); }
}

// ── El perfil C: estado PROPIO, distinto del de A ──────────────────────────────────────────────────
// Lo que C tiene en cada clave que se prueba; el ORÁCULO dice qué tiene que quedar después de importar el archivo de A.
export function perfilC() {
  const pre = (k) => `${k}__${UID}`;
  const ls = [
    [pre('skips_hidden_tracks'), J(ocultosDeC())],
    [pre('skips_hidden_tracks_uris'), J(Object.fromEntries(ocultosDeC().map((id) => [id, `spotify:track:${id}`])))],
    [pre('fonoteca_hidden_pl_skips_hidden_tracks'), PL_SKIPS],
    [pre('versions_dismissed'), J(['versions_dismissed de A 1', 'propio de C'])],
    [pre('discover_escuchados_uris'), J({ 'clave de A 0': 'spotify:track:DE_C_GANA', 'propia de C': 'spotify:track:C' })],
    [pre('likes_borrados_log_v1'), J(registro(18, 1, { deC: true }))],          // 18 de C (del 1 al 18 de sept.) + 4 de A (del 10 al 13): tope 20
    ['versions_dry_run_log_v1', J(registro(3, 20, { deC: true }))],            // sin tope
    [pre('fonoteca_theme_v1'), J({ preferenciaDeC: true })],                    // la tuya gana
    ['lastfm_artist_tags_cache', J({ 'propio de C': { tags: [], at: 1 } })],    // blob viejo SIN marca: la marca de A no entra
    ['versions_dismissed', J(['pelada vieja de C'])],                           // una pelada que la app todavía no migró
  ];
  const idb = [
    [`discover_disco_base_v1_${id22(1, 'a')}`, envolver(baseDisco([lanzamiento(1, 0), { ...lanzamiento(1, 1), name: 'Nombre propio de C' }, lanzamiento(1, 99)], { cortada: true }), 1_700_000_000_000)],
    ['mapa_area_v1_area-1', envolver({ deC: true })],
    [`local_${UID}_history_stats`, envolver({ historialPropioDeC: true })],    // un amigo con UNA de las ocho: no entra ninguna
  ];
  return { idb, ls };
}

/** El oráculo: para cada clave de C, el valor que TIENE que quedar (texto para localStorage). Sin `copia-importar.js`. */
export function oraculoC(lsA, lsC) {
  const pre = (k) => `${k}__${UID}`;
  const a = Object.fromEntries(lsA), c = Object.fromEntries(lsC);
  const unirLista = (x, y) => J([...JSON.parse(x), ...JSON.parse(y).filter((e) => !JSON.parse(x).includes(e))]);
  const unirMapa = (x, y) => { const m = JSON.parse(x); for (const [k, v] of Object.entries(JSON.parse(y))) if (!(k in m)) m[k] = v; return J(m); };
  const unirReg = (x, y, tope) => { const t = JSON.parse(x), f = JSON.parse(y); const ya = new Set(t.map(J)); let u = [...t, ...f.filter((e) => !ya.has(J(e)))].sort((p, q) => (p.fecha < q.fecha ? 1 : p.fecha > q.fecha ? -1 : 0)); if (tope) u = u.slice(0, tope); return J(u); };
  return {
    [pre('skips_hidden_tracks')]: unirLista(c[pre('skips_hidden_tracks')], a[pre('skips_hidden_tracks')]),
    [pre('skips_hidden_tracks_uris')]: unirMapa(c[pre('skips_hidden_tracks_uris')], a[pre('skips_hidden_tracks_uris')]),
    [pre('fonoteca_hidden_pl_skips_hidden_tracks')]: PL_SKIPS,
    [pre('versions_dismissed')]: unirLista(c[pre('versions_dismissed')], a[pre('versions_dismissed')]),
    [pre('discover_escuchados_uris')]: unirMapa(c[pre('discover_escuchados_uris')], a[pre('discover_escuchados_uris')]),
    [pre('likes_borrados_log_v1')]: unirReg(c[pre('likes_borrados_log_v1')], a[pre('likes_borrados_log_v1')], 20),
    versions_dry_run_log_v1: unirReg(c.versions_dry_run_log_v1, a.versions_dry_run_log_v1, null),
    [pre('fonoteca_theme_v1')]: c[pre('fonoteca_theme_v1')],
    lastfm_artist_tags_cache: c.lastfm_artist_tags_cache,
    versions_dismissed: c.versions_dismissed,
  };
}
