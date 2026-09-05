// Doble de `src/js/api.js` para los tests de ocultos. Todo el estado vive en
// `globalThis.__DOBLE`, que el test rearma antes de cada caso.

function d() { return globalThis.__DOBLE; }

export async function getCurrentUserId() { return d().me; }

export async function spotifyFetch(path) {
  d().llamadas.push(path);
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
  d().añadidas.push({ id, uris: [...uris] });
  const pl = d().playlists.find(p => p.id === id);
  for (const uri of uris) pl.items.push(d().pistaDeUri(uri));
  return { snapshot_id: 'x' };
}

export async function removeTracksFromPlaylist(id, uris) {
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
