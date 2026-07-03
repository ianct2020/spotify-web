// Pegar entero en la consola del browser (F12 → Console)
// mientras estas logueado en https://ianct2020.github.io/spotify-web/
// Borra "another one" y crea "anothertwo" con TODOS tus likes reales.

(async () => {
  const TOKEN = localStorage.getItem('sp_access_token');
  if (!TOKEN) return console.error('No hay token — logueate primero');
  const H = { Authorization: 'Bearer ' + TOKEN };
  const HJ = { ...H, 'Content-Type': 'application/json' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function jf(url, opts = {}) {
    while (true) {
      const r = await fetch(url, { ...opts, headers: opts.body ? HJ : H });
      if (r.status === 429) { console.log('rate limit, esperando 10s'); await sleep(10000); continue; }
      const t = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${t}`);
      return t ? JSON.parse(t) : null;
    }
  }

  console.log('%c[1/5] Buscando "another one"...', 'color:#7C3AED');
  let target = null, off = 0;
  while (true) {
    const d = await jf(`https://api.spotify.com/v1/me/playlists?limit=50&offset=${off}`);
    for (const p of d.items) if (p.name.toLowerCase() === 'another one') { target = p; break; }
    if (target || d.items.length < 50) break;
    off += 50;
  }
  if (!target) return console.error('No se encontro "another one"');
  let totalTracks = target.tracks?.total;
  if (totalTracks == null) {
    console.log('   (sin tracks en objeto, fetcheando total...)');
    const meta = await jf(`https://api.spotify.com/v1/playlists/${target.id}?fields=tracks.total`);
    totalTracks = meta?.tracks?.total ?? '?';
  }
  console.log(`   ID ${target.id} — ${totalTracks} tracks`);

  if (!confirm(`Borrar "another one" (${totalTracks} tracks) y crear "anothertwo" con todos tus likes reales?`)) {
    return console.log('Cancelado');
  }

  console.log('%c[2/5] Borrando "another one"...', 'color:#7C3AED');
  await jf(`https://api.spotify.com/v1/playlists/${target.id}/followers`, { method: 'DELETE' });
  console.log('   Borrada');

  console.log('%c[3/5] Cargando TODOS los likes...', 'color:#7C3AED');
  const uris = []; off = 0;
  while (true) {
    const d = await jf(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${off}`);
    for (const it of d.items) if (it.track?.uri) uris.push(it.track.uri);
    console.log(`   ${uris.length}/${d.total}`);
    if (d.items.length < 50) break;
    off += 50;
    await sleep(100);
  }
  console.log(`   ${uris.length} likes cargados`);

  if (uris.length > 10000) return console.error(`Tenes ${uris.length}, no caben en una playlist`);

  console.log('%c[4/5] Creando "anothertwo"...', 'color:#7C3AED');
  const fresh = await jf('https://api.spotify.com/v1/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: 'anothertwo', description: 'Espejo de Liked Songs', public: false })
  });
  console.log(`   ID ${fresh.id}`);

  console.log('%c[5/5] Poblando "anothertwo"...', 'color:#7C3AED');
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await jf(`https://api.spotify.com/v1/playlists/${fresh.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk })
    });
    console.log(`   +${Math.min(i+100, uris.length)}/${uris.length}`);
    await sleep(200);
  }
  console.log('%cLISTO. "anothertwo" tiene ' + uris.length + ' tracks.', 'color:#22C55E;font-weight:bold');
})();
