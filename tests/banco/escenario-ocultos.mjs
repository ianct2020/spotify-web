// El escenario de los bancos de «ocultar un artista» (v=276).
//
// POR QUÉ ES UN MÓDULO Y NO ESTÁ COPIADO EN LOS DOS BANCOS
//
// `ocultar-artista` y `ocultar-artista-disco` necesitan EXACTAMENTE la misma
// Spotify de mentira: los mismos me gusta, las mismas discografías y, sobre
// todo, la misma playlist de ocultos CON ESTADO (lo que se le añade se puede
// volver a leer, que es lo único que permite afirmar «sigue oculto»). Copiarlo
// en los dos archivos es cómo dos dobles del mismo servicio terminan
// contestando distinto sin que nadie lo note — el mismo fallo silencioso que
// `ui/icons.js` vino a cerrar para los glifos.
//
// Y ya pasó dos veces acá dentro, las dos con el doble incumpliendo el contrato
// del servicio real: los ids de artista que no eran de 22 caracteres y el cuerpo
// del DELETE con `{tracks}` en vez de `{items}`. Un arreglo así tiene que valer
// para los dos bancos de una vez.

import { instalarRedSimulada, crearLikes, ARTISTAS, anclar } from './simulado.mjs';

/**
 * Monta la Spotify simulada y siembra lo que las vistas leen de disco.
 * @returns {Promise<{sim, likes, porUri: Map, playlistOcultos: object}>}
 */
export async function montarEscenarioOcultos() {
const sim = instalarRedSimulada();
window.__sim = sim;
const likes = crearLikes();

// ── La Spotify de mentira ───────────────────────────────────────────────────
// La playlist de ocultos tiene ESTADO: lo que se le añade se puede volver a
// leer. Sin eso «sigue oculto» no se podría afirmar — se estaría probando el
// localStorage y nada más.
const playlistOcultos = { id: 'pl-ocultos-artistas', name: 'fonoteca · ocultos (recomendados)', owner: { id: 'usuario-banco' }, items: [] };
const porUri = new Map();
for (const t of likes) porUri.set(t.track.uri, t.track);

sim.ruta('GET', /^\/me$/, () => ({ id: 'usuario-banco', display_name: 'Banco' }));
sim.ruta('GET', /^\/me\/tracks/, ({ url }) => {
  const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 50;
  return { items: likes.slice(off, off + lim), total: likes.length, next: off + lim < likes.length ? 'x' : null };
});
sim.ruta('GET', /^\/me\/playlists/, () => ({ items: [{ ...playlistOcultos, items: undefined }], total: 1, next: null }));
sim.ruta('POST', /^\/me\/playlists/, () => ({ ...playlistOcultos, items: undefined }));
sim.ruta('GET', /^\/playlists\/[^/?]+\?/, () => ({ id: playlistOcultos.id, name: playlistOcultos.name, owner: playlistOcultos.owner, snapshot_id: 's' + playlistOcultos.items.length }));
sim.ruta('GET', /^\/playlists\/[^/]+\/items/, () => ({
  items: playlistOcultos.items.map(uri => ({ added_at: '2026-01-01T00:00:00Z', item: porUri.get(uri) || { uri, id: uri.split(':').pop(), type: 'track', artists: [], album: null } })),
  total: playlistOcultos.items.length, next: null,
}));
sim.ruta('POST', /^\/playlists\/[^/]+\/items/, ({ cuerpo }) => {
  for (const u of (cuerpo?.uris || [])) if (!playlistOcultos.items.includes(u)) playlistOcultos.items.push(u);
  return { snapshot_id: 's' + playlistOcultos.items.length };
});
// ⚠️ El cuerpo del DELETE es `{ items: [{ uri }] }` — la forma POST-migración
// que manda `removeTracksFromPlaylist` (api.js). Con `{ tracks }` (la de antes
// de febrero de 2026) el doble aceptaba la llamada y no borraba nada: la
// prueba de «volver a mostrar» pasaba por el localStorage y la playlist se
// quedaba con la pista, que es justo el fallo que hay que poder ver.
sim.ruta('DELETE', /^\/playlists\/[^/]+\/items/, ({ cuerpo }) => {
  const fuera = new Set((cuerpo?.items || []).map(t => t.uri));
  playlistOcultos.items = playlistOcultos.items.filter(u => !fuera.has(u));
  return { snapshot_id: 's' + playlistOcultos.items.length };
});
// El contexto de filtros de #discover-artists lee la biblioteca de álbumes. No
// es parte de lo que se prueba acá, pero sin el doble la vista escribe un
// console.warn y el banco lo cuenta como ruta sin simular — con razón: una
// ruta que nadie declaró es una que nadie miró.
sim.ruta('GET', /^\/me\/albums/, () => ({ items: [], total: 0, next: null }));
// #follow-artists: a quién sigues. Nadie, para que los cuatro salgan en la lista.
sim.ruta('GET', /^\/me\/library\/contains/, ({ url }) =>
  url.searchParams.get('uris').split(',').map(() => false));
// #similar resuelve top tracks por /search; devolvemos un match real para que
// la uri representativa exista (y el aviso de «solo en este navegador» no salte).
sim.ruta('GET', /^\/search/, ({ url }) => {
  const qq = url.searchParams.get('q') || '';
  const m = /artist:"([^"]+)"/.exec(qq);
  const nombre = m ? m[1] : 'Artista de ejemplo A';
  const t = likes.find(l => l.track.artists[0].name.toLowerCase() === nombre.toLowerCase())?.track;
  if (url.searchParams.get('type') === 'artist') {
    return { artists: { items: ARTISTAS.map(a => ({ ...a, genres: ['prueba'] })), total: ARTISTAS.length } };
  }
  return { tracks: { items: t ? [t] : [], total: t ? 1 : 0, next: null } };
});
// Last.fm, declarado como doble externo (ver simulado.mjs): #similar no toca la red.
sim.rutaExterna(/ws\.audioscrobbler\.com/, ({ url }) => {
  const metodo = new URL(url).searchParams.get('method');
  if (metodo === 'artist.getsimilar') {
    return { similarartists: { artist: ARTISTAS.slice(1).map((a, i) => ({ name: a.name, match: String(0.9 - i * 0.1), image: [] })) } };
  }
  if (metodo === 'artist.gettoptracks') {
    const art = new URL(url).searchParams.get('artist');
    return { toptracks: { track: [{ name: `Tema 1 de ${art.slice(-1)}`, artist: { name: art }, playcount: '100' }] } };
  }
  return {};
});

// ── Sembrar lo que las vistas leen de disco ─────────────────────────────────
const { prefKey } = await import('/js/storage.js');
const { idbSetCached } = await import('/js/idb.js');
const { crearBase, DISCO_BASE_PREFIX } = await import('/js/util/disco-base.js');
localStorage.setItem('fonoteca_last_user_id', 'usuario-banco');
// ⚠️ Animaciones APAGADAS, y no es cosmético: es lo que hace que este banco
// sea determinista.
//
// `ui/reveal.js` arma un `setTimeout` por tarjeta revelada, con su retardo
// escalonado. Bajo `--virtual-time-budget` esos retardos se cobran del
// presupuesto de golpe, y `#discover-artists` sola se comía ~78 s de reloj
// virtual pintando su lista (medido el 06/10 con hitos de
// `performance.now()`). Resultado: el banco pasaba 1 de 3 veces. Con el modo
// en 'nunca', `reveal` no arma ni un temporizador. Acá no se prueban las
// animaciones, se prueba ocultar un artista.
localStorage.setItem(prefKey('fonoteca_anim_v1'), 'nunca');
await anclar(idbSetCached('all_liked_tracks', likes, null));
for (const a of ARTISTAS) {
  const items = [1, 2].map(i => ({
    id: `r-${a.id}-${i}`, name: `Lanzamiento ${i} de ${a.name.slice(-1)}`, type: 'album', img: null,
    release: '2025-06-0' + i, total: 9, artists: [{ id: a.id, name: a.name }],
  }));
  await anclar(idbSetCached(`${DISCO_BASE_PREFIX}${a.id}`, crearBase(items, { fuente: 'nativo', cortada: false }), null));
}


  return { sim, likes, porUri, playlistOcultos };
}
