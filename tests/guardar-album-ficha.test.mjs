// tests/guardar-album-ficha.test.mjs — «Guardar álbum» en la ficha de #similar (v=275, F.3)
//
// El encargo: reusar el «Guardar álbum» que ya existía en dos sitios, NO hacer un
// tercero. Lo que se vigila, sobre el fuente (el comportamiento con la red
// simulada lo mide `tests/banco/escrituras.html`):
//   1. El guardado con su aviso vive UNA vez, en discover-common.js.
//   2. Las dos vistas viejas lo llaman y ya no llevan su copia del aviso.
//   3. La ficha de #similar lo llama, y SOLO después de una confirmación.
//   4. La ficha no escribe en Spotify por su cuenta (nada de PUT, ni de saveAlbumsToLibrary).
//   5. (v=301) Un single va a la biblioteca de álbumes, igual que un álbum: nada
//      de la playlist «fonoteca · sin escuchar», ni de su creación, ni del tracklist.

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, `${msg} — dio ${a}`); };
const leer = r => readFileSync(new URL(r, import.meta.url), 'utf8');
const sinComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const raiz = new URL('../src/js/', import.meta.url).pathname;
const todos = [];
(function rec(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? rec(p) : p.endsWith('.js') && todos.push(p); } })(raiz);

console.log('Un solo aviso de guardado');
const AVISO = 'guardado en tu biblioteca de álbumes';
const conAviso = todos.filter(p => sinComentarios(readFileSync(p, 'utf8')).includes(AVISO));
eq(conAviso.length, 1, 'el texto del aviso está en UN archivo');
ok(conAviso[0].endsWith('features/discover-common.js'), 'y es discover-common.js');
const common = leer('../src/js/features/discover-common.js');
ok(/export async function guardarLanzamientoConAviso\(al\)/.test(common), 'discover-common exporta guardarLanzamientoConAviso');
ok(/const r = await guardarLanzamiento\(al\);/.test(common.slice(common.indexOf('guardarLanzamientoConAviso'))), 'que envuelve a guardarLanzamiento, el de siempre');

// v=301: un single se guarda igual que un álbum, en la biblioteca de álbumes.
// Se fue la playlist «fonoteca · sin escuchar» como destino, y con ella su
// creación y sus avisos.
console.log('\n«Guardar single» va a la biblioteca (v=301)');
const codigoCommon = sinComentarios(common);
ok(!/ensureSinglesPlaylist/.test(common), 'discover-common.js ya no nombra ensureSinglesPlaylist');
ok(!/Creé la playlist/.test(common), 'ni el aviso de «Creé la playlist…» (la pública)');
const iGL = common.indexOf('export async function guardarLanzamiento(');
const cuerpoGL = sinComentarios(common.slice(iGL, common.indexOf('\n}\n', iGL)));
ok(iGL > 0, 'sigue habiendo guardarLanzamiento');
ok(!/addUrisToPlaylists\(/.test(cuerpoGL), 'guardarLanzamiento no llama a addUrisToPlaylists');
ok(!/getAlbumTracks\(/.test(cuerpoGL), 'ni a getAlbumTracks (guardar cuesta una petición, no dos o tres)');
ok(/await saveAlbumsToLibrary\(\[al\.id\]\);\s*return \{ destino: 'biblioteca' \};/.test(cuerpoGL), 'siempre saveAlbumsToLibrary([al.id]) y { destino: \'biblioteca\' }');
ok(!/es un single: /.test(codigoCommon), 'se fue el toast de «es un single: … en la playlist»');
ok(codigoCommon.includes('Guardar el single en tu biblioteca de álbumes de Spotify'), 'el title de «Guardar single» nombra el destino');
ok(/'Guardar álbum' : 'Guardar single'/.test(codigoCommon), 'y las etiquetas «Guardar álbum» / «Guardar single» se quedan');
const conSingles = todos.filter(p => /PLAYLIST_SINGLES|ensureSinglesPlaylist/.test(readFileSync(p, 'utf8')));
eq(conSingles.length, 0, `ningún archivo de src/js nombra PLAYLIST_SINGLES ni ensureSinglesPlaylist (${conSingles.map(p => p.slice(raiz.length)).join(', ')})`);

console.log('\nLas dos vistas viejas');
for (const [v, nombre] of [['new-releases', 'saveAlbum'], ['discover-artists', 'saveAlbumToLibrary']]) {
  const s = leer(`../src/js/features/${v}.js`);
  const ini = s.indexOf(`async function ${nombre}(`);
  const cuerpo = s.slice(ini, s.indexOf('\n}\n', ini));
  ok(ini > 0, `${v}: sigue habiendo ${nombre}`);
  ok(/guardarLanzamientoConAviso\(al\)/.test(cuerpo), `${v}: ${nombre} llama a guardarLanzamientoConAviso`);
  ok(!/guardarLanzamiento\(/.test(sinComentarios(cuerpo)), `${v}: ya no llama a guardarLanzamiento directo`);
  ok(!/showToast\(/.test(cuerpo.replace(/showToast\('Error al añadir[^;]*;/, '')), `${v}: ya no arma avisos de éxito propios`);
  ok(/markAlbumResolved\(al, artistName\)/.test(cuerpo) && /refreshList\(content\)/.test(cuerpo), `${v}: conserva lo suyo (marcar resuelto y repintar)`);
  ok(/btn\.textContent = '✓ Guardado';/.test(cuerpo) && !/En la playlist/.test(cuerpo), `${v}: el botón dice «✓ Guardado» siempre (v=301: ya no hay rama de la playlist)`);
}

console.log('\nLa ficha de #similar');
const sim = leer('../src/js/features/similar-artists.js');
const limpio = sinComentarios(sim);
ok(/import \{[^}]*guardarLanzamientoConAviso[^}]*\} from '\.\/discover-common\.js'/.test(sim), 'importa guardarLanzamientoConAviso de discover-common');
ok(/label: 'Guardar álbum'/.test(sim), 'ofrece una acción «Guardar álbum»');
ok(/acciones: accionesDeAlbum\(r\)/.test(sim), 'y se la pasa a openAlbumCard por el punto de extensión que ya existía');
const g = sim.slice(sim.indexOf('async function guardarAlbumDeFila'));
const iConfirma = g.indexOf('alertModal(');
const iGuarda = g.indexOf('guardarLanzamientoConAviso(');
ok(iConfirma > 0 && iGuarda > iConfirma, 'pide confirmación ANTES de guardar');
ok(/if \(!ok\) return;/.test(g.slice(iConfirma, iGuarda)), 'y si se cancela, sale sin guardar');
ok(!/saveAlbumsToLibrary|saveToLibrary|method:\s*'PUT'|\/me\/library/.test(limpio), 'la ficha no escribe por su cuenta (nada de PUT ni de saveAlbumsToLibrary)');
ok(!/guardarLanzamiento\(/.test(limpio), 'ni llama a guardarLanzamiento sin el aviso');
ok(/albumTotal: hit\.album\?\.total_tracks/.test(sim), 'guarda el total de pistas que ya trae la búsqueda (evita una petición)');
ok(/if \(!r\.albumId \|\| !r\.album\) return \[\];/.test(sim), 'sin albumId no ofrece el botón');
const conf = sinComentarios(sim.slice(sim.indexOf('function textoConfirmarGuardado'), sim.indexOf('async function guardarAlbumDeFila')));
ok(!/PLAYLIST_SINGLES|sin escuchar|playlist/.test(conf), 'la confirmación ya no dice que un single va a la playlist (v=301)');
ok(/Es un single \(\$\{n\} \$\{n === 1 \? 'pista' : 'pistas'\}\)\./.test(conf) && /biblioteca de álbumes de Spotify/.test(conf),
  'la de un single dice que va a la biblioteca de álbumes y que es un single, con sus pistas');
ok(!/Si tiene menos de/.test(conf), 'y la de siempre ya no lleva «Si tiene menos de 4 pistas es un single, y entonces…»');

console.log(`\nOK guardar-album-ficha: ${n} asserts`);
