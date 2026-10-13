// El escenario del banco `ocultos-cache` (v=299, tanda 47).
//
// POR QUÉ ES OTRO ESCENARIO Y NO `escenario-ocultos.mjs` CON OPCIONES
//
// El de `ocultar-artista-*` contesta `snapshot_id: 's' + largo` y devuelve
// `/items` entero con `next: null`. Con eso no se puede probar un caché que
// valida por snapshot: un POST seguido de un DELETE deja el MISMO snapshot con
// otro contenido (un caché roto pasa en verde) y no hay páginas que contar. Los
// tres bancos que lo usan no prueban eso y siguen como estaban; este escenario
// es aparte para no moverles nada.
//
// La playlist simulada de acá miente como la de verdad:
//   · `snapshot_id` es un CONTADOR de escrituras: cambia en cada POST y cada
//     DELETE y nunca vuelve a un valor anterior;
//   · va RETRASADO si se pide (`retraso`): durante las N lecturas de
//     `GET /playlists/{id}?fields=…` siguientes a una escritura devuelve el
//     snapshot ANTERIOR, y `/items` ya devuelve lo nuevo (CLAUDE.md lo midió así);
//   · `/items` PAGINA de a 100, con `offset`/`limit` y `next`: 900 ocultos son
//     9 páginas, como en la cuenta de Ian;
//   · `escrituraAjena(id, cambiar)`: la otra compu escribe sin pasar por la app.
//
// ⚠️ El ESTADO de la Spotify simulada vive en la ventana MADRE (`estado`), no en
// el iframe: cada carga de página es un iframe nuevo, y una playlist que
// renaciera en cada carga con el contador en 0 no probaría nada.
//
// La forma es la de la cuenta de Ian, SEMBRADA y sintética (el repo es público):
// la playlist de ocultos de descubrir con 900 pistas (censo del 06/10), la de
// artistas con 12, y los ids de las dos guardados en el navegador.

import { instalarRedSimulada, crearLikes, ARTISTAS, anclar } from './simulado.mjs';

export const USUARIO = 'usuario-banco';
export const PL_DESCUBRIR = 'plOcultosDescubrir0000';
export const PL_ARTISTAS = 'plOcultosArtistas00000';
const NOMBRES = { [PL_DESCUBRIR]: 'fonoteca · ocultos (descubrir)', [PL_ARTISTAS]: 'fonoteca · ocultos (recomendados)' };

function pistaOculta(i, tipo) {
  const id = (`${tipo}${i}` + 'q'.repeat(22)).slice(0, 22);
  const firma = tipo === 'd' ? `Firma oculta ${i}` : `Artista oculto ${i}`;
  return {
    id, uri: `spotify:track:${id}`, name: `Pista oculta ${i}`, type: 'track',
    artists: [{ id: ('a' + id).slice(0, 22), name: firma }],
    album: { id: ('b' + id).slice(0, 22), name: `Disco oculto ${tipo}${i}`, artists: [{ name: firma }], images: [] },
  };
}

/** El estado compartido entre cargas. Lo crea la madre UNA vez. */
export function crearEstado({ descubrir = 900, artistas = 12 } = {}) {
  const pl = (id, n, tipo) => ({ id, name: NOMBRES[id], owner: { id: USUARIO }, escrituras: 0, snapAnterior: null, retrasoRestante: 0,
    items: Array.from({ length: n }, (_, i) => pistaOculta(i, tipo)) });
  return { retraso: 0, playlists: { [PL_DESCUBRIR]: pl(PL_DESCUBRIR, descubrir, 'd'), [PL_ARTISTAS]: pl(PL_ARTISTAS, artistas, 'r') } };
}

const snapReal = (p) => 's' + p.escrituras;
function snapVisible(p) {
  if (p.retrasoRestante > 0) { p.retrasoRestante--; return p.snapAnterior; }
  return snapReal(p);
}
function anotarEscritura(estado, p) {
  p.snapAnterior = snapReal(p);
  p.escrituras++;
  p.retrasoRestante = estado.retraso || 0;
}

/** La otra compu: toca la playlist a mano y el snapshot avanza (y se retrasa) igual. */
export function escrituraAjena(estado, id, cambiar) {
  const p = estado.playlists[id];
  cambiar(p);
  anotarEscritura(estado, p);
}

/**
 * Monta la Spotify simulada en ESTA carga de página, contra el `estado` de la madre,
 * y siembra lo que las dos vistas de descubrir leen de disco.
 */
export async function montarEscenarioOcultosCache(estado) {
  const sim = instalarRedSimulada();
  window.__sim = sim;
  const likes = crearLikes();
  const porUri = new Map(likes.map(t => [t.track.uri, t.track]));

  sim.ruta('GET', /^\/me$/, () => ({ id: USUARIO, display_name: 'Banco' }));
  sim.ruta('GET', /^\/me\/tracks/, ({ url }) => {
    const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 50;
    return { items: likes.slice(off, off + lim), total: likes.length, next: off + lim < likes.length ? 'x' : null };
  });
  sim.ruta('GET', /^\/me\/playlists/, () => ({
    items: Object.values(estado.playlists).map(p => ({ id: p.id, name: p.name, owner: p.owner, snapshot_id: snapReal(p), items: { total: p.items.length } })),
    total: 2, next: null,
  }));
  sim.ruta('GET', /^\/playlists\/[^/?]+\?/, ({ ruta, url }) => {
    const id = ruta.split('?')[0].split('/')[2];
    const p = estado.playlists[id];
    if (!p) return sim.sinSimular(404);
    const out = { id: p.id, name: p.name, owner: p.owner };
    if ((url.searchParams.get('fields') || '').includes('snapshot_id')) out.snapshot_id = snapVisible(p);
    return out;
  });
  sim.ruta('GET', /^\/playlists\/[^/]+\/items/, ({ ruta, url }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    if (!p) return sim.sinSimular(404);
    const off = +url.searchParams.get('offset') || 0, lim = +url.searchParams.get('limit') || 100;
    const pagina = p.items.slice(off, off + lim);
    return {
      items: pagina.map(t => ({ added_at: '2026-01-01T00:00:00Z', item: t })),
      total: p.items.length, offset: off, limit: lim,
      next: off + lim < p.items.length ? `https://api.spotify.com/v1/playlists/${p.id}/items?offset=${off + lim}&limit=${lim}` : null,
    };
  });
  sim.ruta('POST', /^\/playlists\/[^/]+\/items/, ({ ruta, cuerpo }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    for (const u of (cuerpo?.uris || [])) p.items.push(porUri.get(u) || { uri: u, id: u.split(':').pop(), type: 'track', artists: [], album: null });
    anotarEscritura(estado, p);
    return { snapshot_id: snapReal(p) };
  });
  sim.ruta('DELETE', /^\/playlists\/[^/]+\/items/, ({ ruta, cuerpo }) => {
    const p = estado.playlists[ruta.split('/')[2]];
    const fuera = new Set((cuerpo?.items || []).map(t => t.uri));
    p.items = p.items.filter(t => !fuera.has(t.uri));
    anotarEscritura(estado, p);
    return { snapshot_id: snapReal(p) };
  });
  sim.ruta('GET', /^\/me\/albums/, () => ({ items: [], total: 0, next: null }));
  sim.ruta('GET', /^\/me\/library\/contains/, ({ url }) => url.searchParams.get('uris').split(',').map(() => false));

  // ── Sembrar lo que las vistas leen de disco ───────────────────────────────
  const { prefKey } = await import('/js/storage.js');
  const { idbSetCached } = await import('/js/idb.js');
  const { crearBase, DISCO_BASE_PREFIX } = await import('/js/util/disco-base.js');
  localStorage.setItem('fonoteca_last_user_id', USUARIO);
  localStorage.setItem('fonoteca_perfil_v1', JSON.stringify({ id: USUARIO, display_name: 'Banco' }));
  // Animaciones apagadas: `ui/reveal.js` arma un temporizador por tarjeta (ver
  // `escenario-ocultos.mjs`). Acá no se prueban animaciones.
  localStorage.setItem(prefKey('fonoteca_anim_v1'), 'nunca');
  // Los ids de las dos playlists de ocultos, guardados como en el navegador de Ian.
  localStorage.setItem(prefKey('fonoteca_hidden_pl_discover_ocultos'), PL_DESCUBRIR);
  localStorage.setItem(prefKey('fonoteca_hidden_pl_recs_ocultos'), PL_ARTISTAS);
  localStorage.setItem(prefKey('newrel_months'), '12');
  localStorage.setItem(prefKey('newrel_min_likes'), '10');
  await anclar(idbSetCached('all_liked_tracks', likes, null));
  // Lanzamientos DENTRO de la ventana de 12 meses de #new-releases (2 por artista).
  const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  for (const a of ARTISTAS) {
    const k = a.name.slice(-1);
    const items = [20, 80].map((d, i) => ({
      id: `n-${a.id}-${i + 1}`, name: `Novedad ${k}${i + 1}`, type: 'album', img: null,
      release: dia(d + ARTISTAS.indexOf(a)), total: 9, artists: [{ id: a.id, name: a.name }],
    }));
    await anclar(idbSetCached(`${DISCO_BASE_PREFIX}${a.id}`, crearBase(items, { fuente: 'nativo', cortada: false }), null));
  }
  return { sim, likes };
}
