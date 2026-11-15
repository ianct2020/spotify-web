// Los datos de mentira del banco `recs-estilo.html` (v=369, tanda 132).
//
// 🔴 TODO INVENTADO: el usuario de Last.fm, los artistas, las etiquetas, los temas y los me gusta. El
// repo es público y ningún dato de escucha de nadie entra acá. Lo que tiene que dar cada cosa está
// escrito a mano al lado y `ESPERADO` lo junta: el banco compara la pantalla contra esta cuenta, no
// contra la del código que prueba.

export const UID = 'bancot132usuarioinventado';
export const USUARIO_LASTFM = 'banco-t132-inventado';

// Los tres «top artists» de 6 meses y sus similares (Last.fm). `Ya Me Gusta` está en los me gusta
// (por `artists[0]`), así que no se recomienda.
export const TOP = [['Fuente Uno', 100], ['Fuente Dos', 50], ['Fuente Tres', 10]];
export const SIMILARES = {
  'Fuente Uno': [['Ya Me Gusta', 0.95], ['Niebla Alta', 0.9], ['Doble Bruma', 0.85], ['Bruma Corta', 0.8], ['Cumbia Lenta', 0.7], ['Vals Aparte', 0.6],
    ['Voz Sin Genero', 0.5], ['Nadie Conocido', 0.4], ['Nombre Cambiado', 0.3], ['Cuota Llena', 0.2], ['Caido Cinco', 0.15], ['Niebla Guardada', 0.1]],
  'Fuente Dos': [['Niebla Alta', 0.9], ['Doble Bruma', 0.9], ['Bruma Corta', 0.5]],
  'Fuente Tres': [['Niebla Alta', 0.5]],
};
// El orden de `recommendations` (por fuentes y a igualdad por puntaje), hecho a mano:
//   Niebla Alta 3 fuentes · Doble Bruma 2 (100×0,85 + 50×0,9 = 130) · Bruma Corta 2 (80 + 25 = 105) ·
//   y los de una fuente por su puntaje.
export const RECOMENDADOS = ['Niebla Alta', 'Doble Bruma', 'Bruma Corta', 'Cumbia Lenta', 'Vals Aparte', 'Voz Sin Genero',
  'Nadie Conocido', 'Nombre Cambiado', 'Cuota Llena', 'Caido Cinco', 'Niebla Guardada'];

const E = (name, count = 100) => ({ name, count: String(count), url: 'https://www.last.fm/tag/inventada' });
// Lo que contesta `artist.gettoptags`, la primera vez y (si cambia) la segunda.
export const ETIQUETAS = {
  'Niebla Alta': { tags: [E('Niebla Pop')] },
  'Doble Bruma': { tags: [E('Niebla Pop'), E('Cumbia Lunar', 80)] },
  'Bruma Corta': { tags: [E('niebla pop')] },
  'Cumbia Lenta': { tags: [E('Cumbia Lunar')] },
  'Vals Aparte': { tags: [E('Vals Raro')] },
  'Voz Sin Genero': { tags: [E('female vocalists'), E('british', 60)] },                 // ninguna es un género
  'Nadie Conocido': { error: 6 },                                                          // «no encontrado» → []
  'Nombre Cambiado': { tags: [E('Niebla Pop')], artista: 'Otro Nombre Oficial' },          // autocorrect a OTRO: no cuenta
  'Cuota Llena': { primero: 29, tags: [E('Cumbia Lunar')] },                               // 29 la 1.ª vez; bien la 2.ª
  'Caido Cinco': { primero: 503, tags: [E('female vocalists')] },                          // 503 la 1.ª vez; bien la 2.ª
  // 'Niebla Guardada': SEMBRADA en el almacén como ya buscada por Last.fm (niebla pop): no se pide.
};
export const SEMBRADO = { 'Niebla Guardada': ['niebla pop'] };

// Los top tracks (Last.fm) de los cuatro de «niebla pop» y cómo resuelve cada uno en la Spotify simulada.
//   Niebla Alta: 14 temas; el 3 está en tus me gusta y el 5 no está en Spotify.
//   Doble Bruma: 6 temas, todos en Spotify.
//   Bruma Corta: 20 temas; del 1 al 5 no están en Spotify.
//   Niebla Guardada: `artist.gettoptracks` contesta 29 (Last.fm no contestó).
export const TEMAS = { 'Niebla Alta': 14, 'Doble Bruma': 6, 'Bruma Corta': 20 };
export const SIN_SPOTIFY = { 'Niebla Alta': [5], 'Bruma Corta': [1, 2, 3, 4, 5] };
export const EN_ME_GUSTA = { 'Niebla Alta': [3] };
export const tituloDe = (artista, n) => `Canción ${n} de ${artista}`;
export const idDe = (artista, n) => (artista.replace(/[^A-Za-z]/g, '') + 'x'.repeat(22)).slice(0, 18) + String(n).padStart(4, '0');

// La cuenta a mano.
//   Primera vez («Agrupar por estilo»): se piden los 10 que no están buscados (todos menos Niebla Guardada),
//   se guardan 8 (Cuota Llena y Caido Cinco no) y salen:
//     niebla pop: Niebla Alta, Doble Bruma, Bruma Corta, Niebla Guardada (4) · cumbia lunar: Doble Bruma, Cumbia Lenta (2)
//     sin estilo: 1 sin etiquetas de género (Voz Sin Genero), 2 que Last.fm no tiene (Nadie Conocido; Nombre Cambiado,
//     por el autocorrect), 2 sin buscar (Cuota Llena, Caido Cinco); y Vals Aparte, un estilo que nadie comparte.
//   Segunda vez: se piden SOLO los 2 que no contestaron; cumbia lunar pasa a 3 (con Cuota Llena) y Caido Cinco a
//   «sin etiquetas de género». Tercera vez: 0.
//   La lista de «niebla pop» con 10 temas por artista (tope 13 búsquedas por artista, 52 en total):
//     Niebla Alta: busca 12 (1, 2, 3 = me gusta, 4, 5 = sin match, 6…12) → 10 de 10.
//     Doble Bruma: busca 6 → 6 de 10, Last.fm solo tiene 6.
//     Bruma Corta: busca 13 (1-5 sin match) → 8 de 10, tope.
//     Niebla Guardada: Last.fm no contestó → 0 búsquedas.
//   = 31 búsquedas, 4 `artist.gettoptracks`, 24 temas tildados.
export const ESPERADO = {
  pedidos1: RECOMENDADOS.filter((n) => n !== 'Niebla Guardada'),
  guardados1: RECOMENDADOS.filter((n) => !['Niebla Guardada', 'Cuota Llena', 'Caido Cinco'].includes(n)),
  pedidos2: ['Cuota Llena', 'Caido Cinco'],
  estilos1: [['niebla pop', 4], ['cumbia lunar', 2]],
  sin1: '5 sin estilo: 1 sin etiquetas de género, 2 que Last.fm no tiene, 2 sin buscar (Last.fm no contestó). 1 con un estilo que no comparte ningún otro recomendado.',
  estilos2: [['niebla pop', 4], ['cumbia lunar', 3]],
  sin2: '4 sin estilo: 2 sin etiquetas de género, 2 que Last.fm no tiene. 1 con un estilo que no comparte ningún otro recomendado.',
  lista: {
    busquedas: 31, toptracks: 4, temas: 24, tope: 52,
    cabeceras: {
      'Niebla Alta': '10 de 10: 1 sin match en Spotify, 1 ya en tus me gusta.',
      'Doble Bruma': '6 de 10: Last.fm solo tiene 6 temas.',
      'Bruma Corta': '8 de 10: 5 sin match en Spotify, se llegó al tope de 13 búsquedas.',
      'Niebla Guardada': 'Last.fm no contestó: este artista no tiene temas en la lista.',
    },
  },
  // Con un 429 en la búsqueda número 20: Niebla Alta (12) + Doble Bruma (6) + Bruma Corta (1 sin match, y la 2.ª da 429).
  corte: {
    en: 20,
    aviso: 'Spotify dejó de contestar después de 20 búsquedas: la lista está incompleta.',
    sinBuscar: 'Sin buscar: Niebla Guardada.',
    cabecera: '0 de 10: 1 sin match en Spotify, la búsqueda se cortó aquí.',
  },
};

/** Los me gusta inventados: dos de `Ya Me Gusta` y el tema 3 de Niebla Alta (acreditado primero a otro). */
export function likes() {
  const item = (id, name, artistas) => ({
    added_at: '2025-03-01T00:00:00Z',
    track: { id, uri: `spotify:track:${id}`, name, duration_ms: 200000, explicit: false, is_playable: true, track_number: 1, popularity: 0,
      artists: artistas.map((a, i) => ({ id: `artistainventado${String(i).padStart(6, '0')}`, name: a })),
      album: { id: 'albuminventadot132000', name: 'Álbum inventado', album_type: 'album', total_tracks: 10, release_date: '2020-01-01', images: [] } },
  });
  return [
    item('yamegustainventado0001', 'Tema guardado uno', ['Ya Me Gusta']),
    item('yamegustainventado0002', 'Tema guardado dos', ['Ya Me Gusta']),
    item(idDe('Niebla Alta', 3), tituloDe('Niebla Alta', 3), ['Colaborador Inventado', 'Niebla Alta']),
  ];
}

/** La respuesta de `/search?type=track` para una query `track:"…" artist:"…"`, o `null` si no la entiende. */
export function buscar(q) {
  const m = q.match(/^track:"(.*)" artist:"(.*)"$/);
  if (!m) return null;
  const [, titulo, artista] = m;
  const n = +((titulo.match(/^Canción (\d+) de /) || [])[1] || 0);
  const tiene = TEMAS[artista] && n >= 1 && n <= TEMAS[artista] && !(SIN_SPOTIFY[artista] || []).includes(n) && titulo === tituloDe(artista, n);
  if (!tiene) return { tracks: { items: [], total: 0, limit: 5, offset: 0, next: null } };
  const id = idDe(artista, n);
  const artistas = (EN_ME_GUSTA[artista] || []).includes(n) ? [artista, 'Colaborador Inventado'] : [artista];
  return { tracks: { items: [{ id, uri: `spotify:track:${id}`, name: titulo, artists: artistas.map((a) => ({ name: a })),
    album: { id: `disco${id}`.slice(0, 22), name: `Disco de ${artista}`, images: [] } }], total: 1, limit: 5, offset: 0, next: null } };
}

/**
 * El Last.fm de mentira (vive en la MADRE, o en el caso con `?foto=`). `responder(url)` → `{status, cuerpo}`.
 *   · `congelado = true`: lo que llegue se queda colgado hasta `soltar()`;
 *   · `log`: cada petición con su número, marco, método y artista.
 */
export function crearLastfm() {
  const lf = { log: [], congelado: false, colgadas: [], vecesPorArtista: {} };
  lf.soltar = () => { const c = lf.colgadas; lf.colgadas = []; lf.congelado = false; c.forEach((f) => f()); };
  lf.responder = (url, meta = {}) => {
    const u = new URL(url);
    const metodo = u.searchParams.get('method');
    const artista = u.searchParams.get('artist');
    const entrada = { n: lf.log.length + 1, marco: meta.marco, metodo, artista, user: u.searchParams.get('user'), status: null, codigo: null };
    lf.log.push(entrada);
    const contestar = () => {
      const ok = (obj) => { entrada.status = 200; return { status: 200, cuerpo: JSON.stringify(obj) }; };
      if (metodo === 'user.gettopartists') {
        return ok({ topartists: { artist: TOP.map(([name, playcount], i) => ({ name, playcount: String(playcount), '@attr': { rank: String(i + 1) } })) } });
      }
      if (metodo === 'artist.getsimilar') {
        return ok({ similarartists: { artist: (SIMILARES[artista] || []).map(([name, match]) => ({ name, match: String(match), image: [] })) } });
      }
      if (metodo === 'artist.gettoptags') {
        const r = ETIQUETAS[artista];
        const vez = (lf.vecesPorArtista[artista] = (lf.vecesPorArtista[artista] || 0) + 1);
        if (r?.primero && vez === 1) {
          if (r.primero === 29) { entrada.status = 200; entrada.codigo = 29; return { status: 200, cuerpo: JSON.stringify({ error: 29, message: 'banco: cuota de mentira' }) }; }
          entrada.status = r.primero; return { status: r.primero, cuerpo: '<html>banco: 503 de mentira</html>' };
        }
        if (!r || r.error) { entrada.codigo = 6; return ok({ error: 6, message: 'The artist you supplied could not be found', links: [] }); }
        return ok({ toptags: { tag: r.tags, '@attr': { artist: r.artista || artista } } });
      }
      if (metodo === 'artist.gettoptracks') {
        if (!TEMAS[artista]) { entrada.status = 200; entrada.codigo = 29; return { status: 200, cuerpo: JSON.stringify({ error: 29, message: 'banco: cuota de mentira' }) }; }
        const limit = +u.searchParams.get('limit') || 50;
        const n = Math.min(limit, TEMAS[artista]);
        return ok({ toptracks: { track: Array.from({ length: n }, (_, i) => ({ name: tituloDe(artista, i + 1), playcount: String(1000 - i), listeners: '10', artist: { name: artista } })) } });
      }
      entrada.status = 400;
      return { status: 400, cuerpo: JSON.stringify({ error: 3, message: 'banco: método sin simular' }) };
    };
    if (lf.congelado) { entrada.status = 'colgada'; return new Promise((res) => lf.colgadas.push(() => res(contestar()))); }
    return Promise.resolve(contestar());
  };
  return lf;
}

/** Siembra el registro de `Niebla Guardada` (ya buscado por Last.fm) y la marca de migración. */
export async function sembrarEtiquetas(anclar, uid) {
  const { idbSetVarios } = await import('/js/idb.js');
  const G = await import('/js/util/generos-artista.js');
  const fecha = Date.UTC(2026, 10, 1);
  const pares = Object.entries(SEMBRADO).map(([n, tags]) => {
    const k = n.toLowerCase();
    return [G.claveGeneros(uid, k), { uid, nombre: k, fuentes: { migrado: null, lastfm: { tags: tags.map((name) => ({ name, count: 100 })), fecha, artista: n }, musicbrainz: null, statsfm: null } }];
  });
  pares.push([G.CLAVE_MIGRADO, { uid, fecha, entradas: 0 }]);
  await anclar(idbSetVarios(pares));
}
