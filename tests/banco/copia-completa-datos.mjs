// La siembra del banco `copia-completa` (v=333, tanda 78), sacada a un módulo en la tanda 123 para que la reuse el banco
// `nube` sin copiarla. Lo que siembra no cambió: una clave por fila del censo (`util/copia-completa.js`) con un valor
// INVENTADO, las trampas (otro usuario, claves sin censar) y, con `ian`, datos inventados del TAMAÑO de los de Ian.
//
// PURO: no escribe nada. Devuelve los pares y el que llama los escribe (`localStorage.setItem` y su `sembrarIdb`).
//   C     el módulo `util/copia-completa.js` (el de la raíz que se está probando: el CENSO de esa versión)
//   uid   el usuario de la copia; `otro`, el de las trampas
//   ian   true → el tamaño de Ian (9.548 me gusta, 351 discografías, 2.302 artistas en el mapa y en géneros, 1.950 días de
//         detalle, 5.715 tapas en la base de colores, los seis almacenes de ocultos)
// Devuelve `{ idbPares, lsPares, esperadas: { idb: Set, ls: Set }, nLikes }`. Los secretos, `fonoteca_last_user_id`,
// `fonoteca_perfil_v1` y la marca de los me gusta de otra cuenta NO los siembra: son del que llama.

export function sembrarPerfil({ C, uid, otro, ian = false }) {
  const UID = uid, OTRO = otro;
  const idbPares = [], lsPares = [];
  const esperadas = { idb: new Set(), ls: new Set() };
  const L = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const id22 = (i, p = 'x') => (p + String(i).padStart(21, '0')).slice(0, 22);
  const like = (i) => ({ added_at: `2024-0${1 + i % 9}-1${i % 9}T10:00:00Z`, track: { id: id22(i, 't'), uri: `spotify:track:${id22(i, 't')}`, name: `Tema inventado número ${i}`, popularity: null, duration_ms: 180000 + i % 90000, explicit: i % 7 === 0, is_playable: true, track_number: 1 + i % 12, external_ids: { isrc: `XX${String(i).padStart(10, '0')}` }, artists: [{ id: id22(i % 2302, 'a'), name: `Artista inventado ${i % 2302}` }], album: { id: id22(i % 4000, 'b'), name: `Disco inventado ${i % 4000}`, release_date: '2019-05-17', album_type: 'album', total_tracks: 12, images: [{ url: `https://i.scdn.co/image/ab67616d00001e02${'0'.repeat(24)}${String(i).padStart(16, '0')}`, height: 300, width: 300 }, { url: `https://i.scdn.co/image/ab67616d00004851${'0'.repeat(24)}${String(i).padStart(16, '0')}`, height: 64, width: 64 }] } } });
  const envolver = (value) => ({ value, storedAt: 1_760_000_000_000, expiry: null });
  const nLikes = ian ? 9548 : 40;
  const etiqueta = (n) => ({ uid: UID, nombre: n, fuentes: { migrado: null, lastfm: { tags: L(5, j => ({ name: `género inventado ${j}`, count: 100 - j * 10 })), fecha: 1_760_000_000_000, artista: n }, musicbrainz: { tags: [{ name: 'rock inventado', count: 3 }], fecha: 1_760_000_100_000 }, statsfm: null } });
  const lanzamiento = (a, j) => ({ id: id22(a * 100 + j, 'r'), name: `Lanzamiento inventado ${j}`, album_type: j % 3 ? 'single' : 'album', release_date: `20${10 + j % 15}-01-01`, total_tracks: 1 + j % 14, images: [{ url: `https://i.scdn.co/image/ab67616d00004851${'1'.repeat(24)}${String(a * 100 + j).padStart(16, '0')}`, height: 64, width: 64 }], artists: [{ id: id22(a, 'a'), name: `Artista inventado ${a}` }] });
  const nTapas = ian ? 5715 : 6;
  const muestras = {
    all_liked_tracks: () => envolver(L(nLikes, like)),
    mosaico_colores_v1: () => envolver({ formato: 1, rejilla: '3x3', espacio: 'lineal→srgb8', lado: 64, hosts: ['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com'], ids: L(nTapas, i => id22(i, 'c')), host: Uint8Array.from(L(nTapas, i => i % 3)), datos: Uint8Array.from(L(nTapas * 27, i => (i * 37) % 256)), fallidas: 0, rarasUrl: 0, bytes: nTapas * 2500, msRed: 1, creado: 1, actualizado: 2 }),
    generos_artista_migrado_v1: () => ({ uid: UID, fecha: 1, entradas: 0 }),
  };
  for (const c of C.CENSO) {
    if (c.donde !== 'idb' && c.donde !== 'ls') continue;
    let k;
    if (c.porUsuario === 'clave') k = c.deUsuario(UID) + (c.deUsuario(UID).endsWith('_') ? 'muestra' : '');
    else if (c.prefijo) k = c.clave + 'muestra';
    else if (c.porUsuario === 'pref') k = `${c.clave}__${UID}`;
    else k = c.clave;
    if (c.clase === 5 || c.clave === 'fonoteca_last_user_id' || c.clave === 'fonoteca_perfil_v1') continue;   // los siembra el que llama
    if (c.clave === 'fonoteca_likes_de_otro_v1') continue;   // (v=345) la marca: con ella la copia sale sin me gusta; es el caso «otra-cuenta»
    if (c.donde === 'idb') {
      const v = muestras[k] ? muestras[k]() : k.startsWith('generos_artista_v1_') ? etiqueta('artista inventado') : envolver({ uid: UID, inventado: k });
      idbPares.push([k, v]);
    } else lsPares.push([k, JSON.stringify(['valor inventado', k])]);
    if (c.entra) esperadas[c.donde].add(k);
  }
  // Las trampas.
  lsPares.push([`discover_escuchados__${OTRO}`, JSON.stringify(['de otro'])]);
  lsPares.push(['t78_banco_sin_censar', 'x']);
  idbPares.push([`local_${OTRO}_history_days`, envolver({ otro: 1 })], ['t78_banco_idb_sin_censar', envolver(1)]);

  // ── Con el tamaño de los de Ian (INVENTADO) ─────────────────────────────────
  if (ian) {
    for (let a = 0; a < 351; a++) idbPares.push([`discover_disco_base_v1_${id22(a, 'a')}`, envolver({ fuente: 'nativo', cortada: false, items: L(35, j => lanzamiento(a, j)), reciente: 1_760_000_000_000 })]);
    for (let a = 0; a < 2302; a++) {
      idbPares.push([`mapa_artista_v1_${UID}_artista inventado ${a}`, envolver({ uid: UID, nombre: `artista inventado ${a}`, estado: 'ok', mbid: `${String(a).padStart(8, '0')}-0000-4000-8000-000000000000`, area: `area-${a % 150}`, pais: 'XX', fecha: 1_760_000_000_000 })]);
      idbPares.push([`generos_artista_v1_${UID}_artista inventado ${a}`, etiqueta(`artista inventado ${a}`)]);
    }
    for (let i = 0; i < 150; i++) idbPares.push([`mapa_area_v1_area-${i}`, envolver({ id: `area-${i}`, nombre: `Área inventada ${i}`, pais: 'XX', tipo: 'City', padre: null })]);
    // El detalle por día: 1.950 días, 46.260 temas en el diccionario, 100.400 filas (las cifras de CLAUDE.md).
    const temas = L(46260, i => [`Tema inventado ${i}`, `Artista inventado ${i % 2302}`, id22(i, 't')]);
    const dias = {};
    for (let d = 0; d < 1950; d++) { const f = new Date(Date.UTC(2018, 0, 1 + d)).toISOString().slice(0, 10); dias[f] = L(d < 1000 ? 52 : 51, j => [(d * 53 + j) % 46260, 30000 + (j * 977) % 200000, 1 + j % 3]); }
    idbPares.push([`local_${UID}_history_days`, envolver({ version: 1, temas, dias })]);
    const ocultos = { wthree_hidden_albums: 1400, discover_ocultos: 900, recs_ocultos: 12, skips_hidden_tracks: 500, zeroplays_hidden_tracks: 500, sin_clasificar_ocultas: 500 };
    for (const [k, n] of Object.entries(ocultos)) {
      const claves = L(n, i => `${k === 'wthree_hidden_albums' || k === 'discover_ocultos' ? `disco inventado ${i}||artista inventado ${i % 300}` : id22(i, 'h')}`);
      lsPares.push([`${k}__${UID}`, JSON.stringify(claves)]);
      lsPares.push([`${k}_uris__${UID}`, JSON.stringify(Object.fromEntries(claves.map((c, i) => [c, `spotify:track:${id22(i, 'u')}`])))]);
    }
    for (const k of ['discover_escuchados', 'listened_unreg_dismissed', 'listened_history_dismissed', 'versions_dismissed']) lsPares.push([`${k}__${UID}`, JSON.stringify(L(200, i => `disco inventado ${i}||artista inventado ${i % 300}`))]);
  }
  return { idbPares, lsPares, esperadas, nLikes };
}
