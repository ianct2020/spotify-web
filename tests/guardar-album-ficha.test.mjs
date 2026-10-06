// tests/guardar-album-ficha.test.mjs — «Guardar álbum» en la ficha de #similar (v=275, F.3)
//
// El encargo: reusar el «Guardar álbum» que ya existía en dos sitios, NO hacer un
// tercero. Lo que se vigila, sobre el fuente (el comportamiento con la red
// simulada lo mide `tests/banco/escrituras.html`):
//   1. El guardado con su aviso vive UNA vez, en discover-common.js.
//   2. Las dos vistas viejas lo llaman y ya no llevan su copia del aviso.
//   3. La ficha de #similar lo llama, y SOLO después de una confirmación.
//   4. La ficha no escribe en Spotify por su cuenta (nada de PUT, ni de saveAlbumsToLibrary).

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
eq((common.match(/Creé la playlist «\$\{PLAYLIST_SINGLES\}»/g) || []).length, 1, 'el aviso de la playlist pública también está una sola vez');

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
  ok(/btn\.textContent = r\.destino === 'biblioteca' \? '✓ Guardado' : '✓ En la playlist'/.test(cuerpo), `${v}: el botón sigue diciendo adónde fue`);
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
ok(/PLAYLIST_SINGLES/.test(g + sim.slice(sim.indexOf('function textoConfirmarGuardado'))), 'la confirmación avisa de que un single va a la playlist');

console.log(`\nOK guardar-album-ficha: ${n} asserts`);
