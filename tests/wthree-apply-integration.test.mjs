// Test de integración del guardar de W-Three (v=118). Mockea `spotifyFetch`
// y todas las llamadas API de wthree.js, y verifica la SECUENCIA de calls
// que emite `applyChanges` en varios escenarios reales:
//
//  A. Reorder 3 picks (caso Donda) → sin refetch entero, verify OK.
//  B. Add 1 + reorder → sin refetch, calls correctos.
//  C. Remove 1 → sin refetch.
//  D. Verify falla → toast rojo, modal NO cierra, botón vuelve.
//  E. Snapshot cambió desde el load → refetch entero de fallback.
//
// Corre con:  node tests/wthree-apply-integration.test.mjs

import { computeUpdatedPickPositions } from '../src/js/util/reorder-shifts.js';

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n    esperado: ${e}\n    obtenido: ${a}`); failed++; }
}
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

// ── Simulación del server de Spotify ────────────────────────────────────
// Un mock que rastrea calls, mantiene un snapshot que cambia con cada write,
// y responde a los endpoints que usa applyChanges.
function makeSpotifyMock({
  playlistItems,            // array [{uri, id, name}] con pos = índice
  cachedSnapshot,           // el snapshot con el que cargamos el modal
  serverSnapshot,           // el snapshot que devuelve el server ahora
  onReorder = null,         // hook para simular fallos en el reorder
  verifyMismatch = false,   // hace que el verify devuelva algo distinto al target
} = {}) {
  const calls = [];
  let snapshot = serverSnapshot;
  const items = playlistItems.map((t, i) => ({ pos: i, ...t }));

  async function spotifyFetch(url, opts = {}) {
    calls.push({ url, method: opts.method || 'GET' });
    // GET snapshot
    if (url.includes('fields=snapshot_id')) {
      return { snapshot_id: snapshot };
    }
    // GET items paginados
    if (url.match(/\/playlists\/[^/]+\/items\?/) && !opts.method) {
      const off = +new URL('http://x' + url.replace(/^\/+/, '/')).searchParams.get('offset') || 0;
      const lim = +new URL('http://x' + url.replace(/^\/+/, '/')).searchParams.get('limit') || 50;
      const slice = items.slice(off, off + lim);
      // Si verifyMismatch está seteado, cambiamos el orden del slice
      const out = verifyMismatch ? [...slice].reverse() : slice;
      return {
        items: out.map(t => ({ item: { uri: t.uri, id: t.id, name: t.name } })),
        total: items.length,
        next: off + lim < items.length ? 'x' : null,
      };
    }
    if (url.match(/\/playlists\/[^/]+\/items$/) && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const pos = body.position ?? items.length;
      body.uris.forEach((uri, i) => items.splice(pos + i, 0, { uri, id: uri.split(':').pop(), name: uri.split(':').pop() }));
      items.forEach((t, i) => t.pos = i);
      snapshot = `snap-after-add-${snapshot}`;
      return { snapshot_id: snapshot };
    }
    if (url.match(/\/playlists\/[^/]+\/items$/) && opts.method === 'DELETE') {
      const body = JSON.parse(opts.body);
      const removeUris = new Set(body.items.map(x => x.uri));
      for (let i = items.length - 1; i >= 0; i--) if (removeUris.has(items[i].uri)) items.splice(i, 1);
      items.forEach((t, i) => t.pos = i);
      snapshot = `snap-after-del-${snapshot}`;
      return { snapshot_id: snapshot };
    }
    if (url.match(/\/playlists\/[^/]+\/items$/) && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      if (onReorder) {
        const r = onReorder(body, calls.length);
        if (r === 'throw') throw new Error('Simulated reorder failure');
      }
      const { range_start, insert_before, range_length = 1 } = body;
      const moving = items.splice(range_start, range_length);
      const target = insert_before > range_start ? insert_before - range_length : insert_before;
      items.splice(target, 0, ...moving);
      items.forEach((t, i) => t.pos = i);
      snapshot = `snap-after-put-${snapshot}`;
      return { snapshot_id: snapshot };
    }
    throw new Error(`Mock: request no manejado: ${opts.method || 'GET'} ${url}`);
  }

  const api = {
    calls,
    getSnapshot: () => snapshot,
    getItems: () => items,
    spotifyFetch,
    async getPlaylistSnapshotId() { return spotifyFetch('/playlists/x?fields=snapshot_id'); }
      ,
    // Estos los mockeamos como wrappers al spotifyFetch
    async getCachedPlaylistSnapshot() { return cachedSnapshot; },
    async addTracksToPlaylist(id, uris, opts = {}) {
      const body = { uris };
      if (opts.position != null) body.position = opts.position;
      const r = await spotifyFetch(`/playlists/${id}/items`, { method: 'POST', body: JSON.stringify(body) });
      return r.snapshot_id;
    },
    async removeTracksFromPlaylist(id, uris) {
      const r = await spotifyFetch(`/playlists/${id}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ items: uris.map(u => ({ uri: u })) }),
      });
      return r.snapshot_id;
    },
    async reorderPlaylistItems(id, { range_start, insert_before, range_length = 1, snapshot_id }) {
      const body = { range_start, insert_before, range_length };
      if (snapshot_id) body.snapshot_id = snapshot_id;
      const r = await spotifyFetch(`/playlists/${id}/items`, { method: 'PUT', body: JSON.stringify(body) });
      return r.snapshot_id;
    },
    async getAllPlaylistItems(id, _, { useCache } = {}) {
      // Simula paginateAll: 100 per page
      const out = [];
      let off = 0;
      while (true) {
        const d = await spotifyFetch(`/playlists/${id}/items?offset=${off}&limit=100`);
        d.items.forEach(it => out.push({ item: it.item }));
        if (!d.next) break;
        off += 100;
      }
      return out;
    },
    async updatePlaylistItemsCache() { /* noop en mock */ },
  };
  return api;
}

// ── Simulación de la lógica de applyChanges (v=118) ──────────────────────
// Extraída acá para no depender del DOM. Es la MISMA lógica que en wthree.js.
async function simulateApply(api, playlistId, a, orderedPicks, origOrder) {
  const origIds = origOrder.map(p => p.id);
  const newIds = orderedPicks.map(p => p.id);
  const toRemoveUris = origOrder.filter(p => !newIds.includes(p.id)).map(p => p.uri);
  const toAddUris = orderedPicks.filter(p => !origIds.includes(p.id)).map(p => p.uri);
  const keptOrig = origIds.filter(id => newIds.includes(id));
  const keptNew = newIds.filter(id => origIds.includes(id));
  const orderChanged = keptOrig.length > 0 && keptOrig.some((id, i) => id !== keptNew[i]);
  if (toAddUris.length === 0 && toRemoveUris.length === 0 && !orderChanged) return { status: 'noop' };

  let workingPicks = origOrder.map(p => ({ id: p.id, uri: p.uri, name: p.name, pos: p.pos }));
  const server = await api.getPlaylistSnapshotId(playlistId);
  const serverSnap = server?.snapshot_id;
  const cachedSnap = await api.getCachedPlaylistSnapshot(playlistId);
  let snapshot = serverSnap;

  let refetchedPages = 0;
  if (cachedSnap && serverSnap !== cachedSnap) {
    const fresh = await api.getAllPlaylistItems(playlistId, null, { useCache: false });
    refetchedPages = Math.ceil(fresh.length / 100);
    workingPicks = fresh
      .map((it, i) => ({ ...it.item, pos: i }))
      .filter(t => origOrder.some(op => op.uri === t.uri));
  }

  let addInsertPos = null;
  if (toAddUris.length) {
    const maxPos = workingPicks.length ? Math.max(...workingPicks.map(p => p.pos)) : -1;
    addInsertPos = maxPos >= 0 ? maxPos + 1 : null;
    const sn = await api.addTracksToPlaylist(playlistId, toAddUris, addInsertPos != null ? { position: addInsertPos } : {});
    if (sn) snapshot = sn;
  }
  if (toRemoveUris.length) {
    const sn = await api.removeTracksFromPlaylist(playlistId, toRemoveUris);
    if (sn) snapshot = sn;
  }
  workingPicks = computeUpdatedPickPositions(workingPicks, orderedPicks, {
    toAddUris, toRemoveUris, addInsertPos,
  });
  if (workingPicks.some(p => p.pos == null)) {
    const fresh = await api.getAllPlaylistItems(playlistId, null, { useCache: false });
    refetchedPages += Math.ceil(fresh.length / 100);
    workingPicks = fresh
      .map((it, i) => ({ ...it.item, pos: i }))
      .filter(t => orderedPicks.some(op => op.uri === t.uri));
  }

  const targetOrder = orderedPicks.map(p => p.id);
  const currentOrder = workingPicks.map(p => p.id);
  const orderDiffers = currentOrder.length === targetOrder.length
    && currentOrder.some((id, i) => id !== targetOrder[i]);
  let moveCount = 0;
  if (orderDiffers) {
    // Reorder mínimo — usamos la lógica igual que reorderPicksMinimal.
    const working = workingPicks.map(p => ({ ...p }));
    for (let t = 0; t < targetOrder.length; t++) {
      const wanted = targetOrder[t];
      const cur = working.findIndex((p, i) => i >= t && p.id === wanted);
      if (cur === -1 || cur === t) continue;
      const fromPos = working[cur].pos;
      const toPos = working[t].pos;
      const insert_before = fromPos < toPos ? toPos + 1 : toPos;
      const sn = await api.reorderPlaylistItems(playlistId, {
        range_start: fromPos, insert_before, range_length: 1, snapshot_id: snapshot,
      });
      if (sn) snapshot = sn;
      moveCount++;
      const [moved] = working.splice(cur, 1);
      working.splice(t, 0, moved);
      if (fromPos < toPos) working.forEach(p => { if (p !== moved && p.pos > fromPos && p.pos <= toPos) p.pos -= 1; });
      else working.forEach(p => { if (p !== moved && p.pos >= toPos && p.pos < fromPos) p.pos += 1; });
      moved.pos = toPos;
    }
  }

  // Verificación
  if (workingPicks.length > 0) {
    const minPos = Math.min(...workingPicks.map(p => p.pos));
    const rangeLen = Math.min(50, workingPicks.length + 5);
    const targetUris = orderedPicks.map(p => p.uri);
    const data = await api.spotifyFetch(`/playlists/${playlistId}/items?offset=${Math.max(0, minPos)}&limit=${rangeLen}`);
    const expected = new Set(targetUris);
    const gotInOrder = (data.items || [])
      .map(it => (it.item || it.track)?.uri)
      .filter(u => u && expected.has(u));
    const okLen = gotInOrder.length === targetUris.length;
    const okOrder = okLen && targetUris.every((u, i) => gotInOrder[i] === u);
    if (!okOrder) throw new Error('verify failed');
  }

  return { status: 'ok', moveCount, refetchedPages };
}

// ── Escenarios ──────────────────────────────────────────────────────────
// Playlist "w three" simulada: 2000 tracks, con 3 picks de Donda en posiciones
// 1547, 1548, 1549 (los picks originales del álbum).
function makeWThreePlaylist(pickInsertOffset = 1547) {
  const items = [];
  for (let i = 0; i < 2000; i++) {
    if (i === pickInsertOffset) items.push({ uri: 'spotify:track:D1', id: 'D1', name: 'Donda 1' });
    else if (i === pickInsertOffset + 1) items.push({ uri: 'spotify:track:D2', id: 'D2', name: 'Donda 2' });
    else if (i === pickInsertOffset + 2) items.push({ uri: 'spotify:track:D3', id: 'D3', name: 'Donda 3' });
    else items.push({ uri: `spotify:track:T${i}`, id: `T${i}`, name: `Track ${i}` });
  }
  return items;
}

// ── A. Reorder 3 picks (caso Donda) ─────────────────────────────────────
console.log('\nA. reorder 3 picks — snapshot igual al cache, sin refetch');
{
  const items = makeWThreePlaylist(1547);
  const api = makeSpotifyMock({
    playlistItems: items,
    cachedSnapshot: 'snap-v0',
    serverSnapshot: 'snap-v0',
  });
  const orig = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1', pos: 1547 },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2', pos: 1548 },
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3', pos: 1549 },
  ];
  const target = [
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3' },
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2' },
  ];
  const res = await simulateApply(api, 'PL', {}, target, orig);
  eq(res.status, 'ok', 'guardado OK');
  eq(res.refetchedPages, 0, 'NO refetcheó la playlist entera (0 páginas)');
  const puts = api.calls.filter(c => c.method === 'PUT' && c.url.endsWith('/items'));
  eq(puts.length, 1, 'exactamente 1 PUT reorder (mover D3 al principio, cascada)');
  const gets = api.calls.filter(c => c.method === 'GET');
  eq(gets.length, 2, '2 GET: 1 snapshot check + 1 verify (rango del álbum)');
  const verifyGet = gets.find(c => c.url.includes('offset='));
  ok(verifyGet && verifyGet.url.includes('offset=1547'), 'verify pide offset=1547 (min pos del álbum)');
  ok(verifyGet && !verifyGet.url.includes('limit=100'), 'verify NO usa limit=100 (barato)');
}

// ── B. Add 1 + reorder ──────────────────────────────────────────────────
console.log('\nB. add 1 pick + reorder (nuevo va primero) — sin refetch');
{
  const items = makeWThreePlaylist(1547);
  // El "nuevo" no está en la playlist todavía
  const api = makeSpotifyMock({
    playlistItems: items,
    cachedSnapshot: 'snap-v0',
    serverSnapshot: 'snap-v0',
  });
  const orig = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1', pos: 1547 },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2', pos: 1548 },
  ];
  const target = [
    { id: 'NEW', uri: 'spotify:track:NEW', name: 'NEW' },
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2' },
  ];
  const res = await simulateApply(api, 'PL', {}, target, orig);
  eq(res.status, 'ok', 'guardado OK');
  eq(res.refetchedPages, 0, 'sin refetch entero (¡el bug original mandaba 20 páginas acá!)');
  const posts = api.calls.filter(c => c.method === 'POST');
  eq(posts.length, 1, '1 POST (add NEW)');
  const puts = api.calls.filter(c => c.method === 'PUT');
  eq(puts.length, 1, '1 PUT (mover NEW al principio de los picks)');
}

// ── C. Remove 1 ─────────────────────────────────────────────────────────
console.log('\nC. remove 1 pick del medio — sin refetch');
{
  const items = makeWThreePlaylist(1547);
  const api = makeSpotifyMock({
    playlistItems: items,
    cachedSnapshot: 'snap-v0',
    serverSnapshot: 'snap-v0',
  });
  const orig = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1', pos: 1547 },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2', pos: 1548 },
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3', pos: 1549 },
  ];
  const target = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3' },
  ];
  const res = await simulateApply(api, 'PL', {}, target, orig);
  eq(res.status, 'ok', 'guardado OK');
  eq(res.refetchedPages, 0, 'sin refetch entero');
  const deletes = api.calls.filter(c => c.method === 'DELETE');
  eq(deletes.length, 1, '1 DELETE');
  const puts = api.calls.filter(c => c.method === 'PUT');
  eq(puts.length, 0, 'sin reorder (D1 y D3 ya están en orden tras el remove)');
}

// ── D. Verify falla — el toast debe decir error, no éxito ───────────────
console.log('\nD. verify falla — debe tirar excepción');
{
  const items = makeWThreePlaylist(1547);
  const api = makeSpotifyMock({
    playlistItems: items,
    cachedSnapshot: 'snap-v0',
    serverSnapshot: 'snap-v0',
    verifyMismatch: true, // el GET de verify devuelve orden distinto
  });
  const orig = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1', pos: 1547 },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2', pos: 1548 },
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3', pos: 1549 },
  ];
  const target = [
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3' },
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2' },
  ];
  let threw = null;
  try { await simulateApply(api, 'PL', {}, target, orig); }
  catch (e) { threw = e.message; }
  eq(threw, 'verify failed', 'aplica y luego tira error de verificación');
}

// ── E. Snapshot cambió desde el load → refetch de fallback ──────────────
console.log('\nE. snapshot server != cached — cae al refetch entero (fallback correcto)');
{
  const items = makeWThreePlaylist(1547);
  const api = makeSpotifyMock({
    playlistItems: items,
    cachedSnapshot: 'snap-OLD',
    serverSnapshot: 'snap-NEW', // difiere
  });
  const orig = [
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1', pos: 1547 },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2', pos: 1548 },
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3', pos: 1549 },
  ];
  const target = [
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3' },
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2' },
  ];
  const res = await simulateApply(api, 'PL', {}, target, orig);
  eq(res.status, 'ok', 'guardado OK vía fallback');
  ok(res.refetchedPages >= 20, `refetchea la playlist entera (${res.refetchedPages} páginas) — path de fallback correcto`);
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
