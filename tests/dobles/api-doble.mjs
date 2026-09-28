// Doble de `src/js/api.js` para los tests de ocultos. Todo el estado vive en
// `globalThis.__DOBLE`, que el test rearma antes de cada caso.
//
// ⚠️ POR QUÉ ESTE DOBLE VALIDA (v=252) ──────────────────────────────────────
//
// `util/hidden-recover.js` pidió `/search?…&limit=20` desde que nació (v=205,
// 05/09) y el máximo de `/search` es 10 desde agosto: la función NUNCA recuperó
// nada, y **este archivo es la razón de que nadie se enterara**. El doble
// contestaba lo que le pedía el test sin mirar el `path`, o sea que fingía justo
// la parte que fallaba: el test verde certificaba una función muerta.
//
// La lección no es «hay que pegarle a la red de verdad» —un test que pide a
// Spotify es lento, gasta cuota y falla por motivos ajenos—. Es que un doble
// tiene que **hacer cumplir el contrato del servicio que reemplaza**. Lo que un
// doble sí puede fingir es el CONTENIDO de la respuesta; lo que no puede fingir
// es que una petición inválida sea válida.
//
// Así que acá van los límites REALES de la API, verificados y anotados en
// `CONTEXTO-TECNICO.md`. Un request que el Spotify de verdad rechazaría, este
// doble lo rechaza con el mismo error y con el mismo texto (`api.js:151` arma
// `Spotify ${status}: ${msg}`). Si alguien vuelve a subir un `limit`, el test
// que ya existe se pone rojo sin que nadie tenga que acordarse de mirarlo.
//
// Si mañana Spotify cambia un tope, se cambia ACÁ y el repo entero se revisa
// solo.
const TOPES = {
  // GET /search: bajó de 50 a 10 en la migración de agosto de 2026 (medido
  // 2026-08-06: 8 y 10 → 200; 12, 15, 20, 30, 50 → 400 «Invalid limit»).
  '/search': 10,
  // GET /albums/{id}/tracks: sigue en 50.
  '/albums': 50,
  // GET /playlists/{id}/items: 100 por página, como siempre.
  '/playlists': 100,
};

function topeDe(path) {
  const base = '/' + String(path).split('?')[0].split('/').filter(Boolean)[0];
  return TOPES[base];
}

/**
 * Los mismos 400 que devolvería la API de verdad. Es lo único que este doble NO
 * deja negociar: el test puede inventar la respuesta, no la validez del pedido.
 */
function validarPath(path) {
  const m = String(path).match(/[?&]limit=([^&]*)/);
  if (!m) return;
  const tope = topeDe(path);
  if (tope == null) return;
  const limit = Number(m[1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > tope) {
    throw new Error('Spotify 400: Invalid limit');
  }
}

function d() { return globalThis.__DOBLE; }

export async function getCurrentUserId() { return d().me; }

export async function spotifyFetch(path) {
  d().llamadas.push(path);
  // Antes de cualquier otra cosa: si el pedido es inválido, la API de verdad no
  // llega a mirar el resto. Contar la llamada primero igual, que es lo que
  // también hace el contador de cuota real.
  validarPath(path);
  const m = path.match(/^\/playlists\/([^/?]+)\?/);
  if (m) {
    const pl = d().playlists.find(p => p.id === m[1]);
    if (!pl) throw new Error('404 Not Found');
    return { id: pl.id, name: pl.name, owner: { id: pl.owner } };
  }
  const t = path.match(/^\/playlists\/([^/?]+)\/items\?limit=1$/);
  if (t) {
    const pl = d().playlists.find(p => p.id === t[1]);
    return { total: pl ? pl.items.length : 0 };
  }
  if (d().buscar) return d().buscar(path);
  throw new Error(`el doble no sabe responder a ${path}`);
}

export async function getAllUserPlaylists() {
  return d().playlists.map(p => ({ id: p.id, name: p.name, owner: { id: p.owner } }));
}

export async function getAllPlaylistItems(id) {
  const pl = d().playlists.find(p => p.id === id);
  return (pl ? pl.items : []).map(t => ({ item: t }));
}

export async function addTracksToPlaylist(id, uris) {
  if (d().fallarAdd) throw new Error(d().fallarAdd);
  d().añadidas.push({ id, uris: [...uris] });
  const pl = d().playlists.find(p => p.id === id);
  for (const uri of uris) pl.items.push(d().pistaDeUri(uri));
  return { snapshot_id: 'x' };
}

export async function removeTracksFromPlaylist(id, uris) {
  if (d().fallarRemove) throw new Error(d().fallarRemove);
  d().quitadas.push({ id, uris: [...uris] });
  const pl = d().playlists.find(p => p.id === id);
  pl.items = pl.items.filter(t => !uris.includes(t.uri));
  return { snapshot_id: 'x' };
}

export async function createPlaylist(name) {
  const pl = { id: `nueva-${d().playlists.length}`, name, owner: d().me, items: [] };
  d().playlists.push(pl);
  d().creadas.push(name);
  return { id: pl.id };
}
