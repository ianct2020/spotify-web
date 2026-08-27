// tests/listened-cruce.test.mjs — el cruce de «Quizás escuchaste y no
// registraste» (v=164)
//
// Lo que se protege acá es la SIMETRÍA de la clave. `groupItemsByAlbum` (el
// registro) saca el artista del ÁLBUM; `attachLikes` (los likes) lo saca del
// artista principal más frecuente entre las PISTAS. Para un recopilatorio, una
// banda sonora o un disco donde lo likeado son colaboraciones, los dos no
// coinciden, y `albumKey(nombre, artista)` daba claves distintas para el MISMO
// disco: el modal seguía ofreciendo discos ya registrados en otra edición, y al
// añadirlos quedaban registrados dos veces (de ahí «Duplicados»).
//
// `listened-shared.js` importa módulos de navegador, pero solo los USA dentro de
// las funciones del picker: alcanza con stubear lo que se toca al importar.

globalThis.localStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
  body: { classList: { add() {}, remove() {} }, appendChild() {} },
};

const { groupItemsByAlbum, albumKey } = await import('../src/js/features/listened-shared.js');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

const item = (albumId, albumName, albumArtist, trackName, trackArtist, uri) => ({
  added_at: '2026-01-01T00:00:00Z',
  item: {
    name: trackName,
    uri,
    artists: [{ name: trackArtist }],
    album: {
      id: albumId,
      name: albumName,
      artists: [{ name: albumArtist }],
      release_date: '2020-01-01',
      images: [{ url: 'x' }],
    },
  },
});

console.log('\n— artistAlts recoge los dos lados —');
{
  // Una banda sonora: el álbum es de «Various Artists», la pista likeada es de
  // Teriyaki Boyz. Antes de v=164 el registro solo conocía la primera.
  const [a] = groupItemsByAlbum([
    item('AL1', 'Tokyo Drift OST', 'Various Artists', 'Tokyo Drift', 'Teriyaki Boyz', 'spotify:track:t1'),
  ]);
  ok(a.artist === 'Various Artists', 'el `artist` sigue saliendo del álbum (no se cambió el comportamiento viejo)');
  ok(Array.isArray(a.artistAlts), 'artistAlts sale como array (sobrevive al JSON del caché)');
  ok(a.artistAlts.includes('Various Artists'), 'artistAlts trae el artista del ÁLBUM');
  ok(a.artistAlts.includes('Teriyaki Boyz'), 'artistAlts trae el artista de la PISTA');
}

console.log('\n— el cruce por clave, antes y después —');
{
  const registrados = groupItemsByAlbum([
    item('AL1', 'Tokyo Drift OST', 'Various Artists', 'Tokyo Drift', 'Teriyaki Boyz', 'spotify:track:t1'),
  ]);
  // Del lado de los likes: OTRA edición del mismo disco (otro id, otras uris) y
  // el artista sale de la pista.
  const enLikes = { name: 'Tokyo Drift OST (Deluxe)', artist: 'Teriyaki Boyz', artistAlts: ['Teriyaki Boyz'] };

  const claveVieja = new Set(registrados.map(a => albumKey(a.name, a.artist)));
  ok(!claveVieja.has(albumKey(enLikes.name, enLikes.artist)),
     'con la clave vieja NO se cruzaban — el disco se ofrecía ya estando registrado');

  const claveNueva = new Set();
  for (const a of registrados) {
    claveNueva.add(albumKey(a.name, a.artist));
    for (const alt of a.artistAlts) claveNueva.add(albumKey(a.name, alt));
  }
  const clavesDeLikes = enLikes.artistAlts.map(x => albumKey(enLikes.name, x));
  ok(clavesDeLikes.some(k => claveNueva.has(k)),
     'con artistAlts SÍ se cruzan — el disco deja de ofrecerse');
}

console.log('\n— no se cruza lo que no es el mismo disco —');
{
  const registrados = groupItemsByAlbum([
    item('AL9', 'Blonde', 'Frank Ocean', 'Nikes', 'Frank Ocean', 'spotify:track:z1'),
  ]);
  const claveNueva = new Set();
  for (const a of registrados) {
    claveNueva.add(albumKey(a.name, a.artist));
    for (const alt of a.artistAlts) claveNueva.add(albumKey(a.name, alt));
  }
  const otro = { name: 'Channel Orange', artistAlts: ['Frank Ocean'] };
  ok(!otro.artistAlts.map(x => albumKey(otro.name, x)).some(k => claveNueva.has(k)),
     'otro disco del mismo artista NO se da por registrado');

  const homonimo = { name: 'Blonde', artistAlts: ['Guy Ritchie'] };
  ok(!homonimo.artistAlts.map(x => albumKey(homonimo.name, x)).some(k => claveNueva.has(k)),
     'un disco homónimo de otro artista NO se da por registrado');
}

console.log('\n— varias pistas del mismo álbum acumulan artistas —');
{
  const [a] = groupItemsByAlbum([
    item('AL2', 'DATA', 'Tainy', 'BUENOS AIRES', 'Tainy', 'spotify:track:a'),
    item('AL2', 'DATA', 'Tainy', 'FANTASMA | AVC', 'JHAYCO', 'spotify:track:b'),
  ]);
  ok(a.tracks.length === 2, 'las dos pistas quedan en el mismo álbum');
  ok(a.artistAlts.includes('Tainy') && a.artistAlts.includes('JHAYCO'),
     'artistAlts junta los principales de todas las pistas');
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallaron) process.exit(1);
