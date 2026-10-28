// W-Three: el historial fallido tiene que verse mientras el resto se pinta.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

globalThis.__T92B_WTHREE = { historialError: null, historialCalls: 0, playlistCalls: 0 };
const avisos = [];
console.warn = (...a) => avisos.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' '));
globalThis.localStorage = { getItem: k => k === 'wthree_playlist_id' ? 'playlist-inventada' : k === 'wthree_playlist_name' ? 'Playlist inventada' : null, setItem() {}, removeItem() {} };
const elementos = new Map();
function elemento(id) {
  if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', style: {}, textContent: '', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null });
  return elementos.get(id);
}
globalThis.document = { getElementById: elemento, querySelectorAll: () => [], addEventListener() {} };
register('./dobles/loader-catch-92b-wthree.mjs', pathToFileURL(import.meta.filename));
const wthree = await import('../src/js/features/wthree.js');
let bien = 0, mal = 0;
function ok(cond, nombre) { console.log(`  ${cond ? '✓' : '✗'} ${nombre}`); cond ? bien++ : mal++; }
const hash = x => createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex');
async function pintar(error) {
  elementos.clear(); avisos.length = 0;
  Object.assign(globalThis.__T92B_WTHREE, { historialError: error, historialCalls: 0, playlistCalls: 0 });
  await wthree.render(elemento('contenedor'));
  await new Promise(r => setTimeout(r, 0));
  return elemento('wthree-content').innerHTML;
}

console.log('[2a] Fallo de historial INVENTADO');
const conFallo = await pintar('doble: historial no disponible');
ok(globalThis.__T92B_WTHREE.historialCalls === 1, 'intentó leer el historial una vez');
ok(globalThis.__T92B_WTHREE.playlistCalls === 1, 'siguió leyendo la playlist');
ok(/No se han podido leer tus álbumes escuchados/.test(conFallo), 'la pantalla dice qué falló y que sigue');
ok(/playlist|Playlist/i.test(conFallo), 'el resto de la vista sigue visible');
ok(avisos.some(x => x.includes('[wthree]') && x.includes('doble: historial no disponible')), 'console.warn conserva el error crudo');

console.log('[2b] Conservación con historial leído y vacío válido');
const sano = await pintar(null);
ok(!/No se han podido leer tus álbumes escuchados/.test(sano), 'sin aviso falso');
ok(avisos.length === 0, 'sin warning falso');
ok(/Playlist inventada/.test(sano), 'la vista normal permanece');
ok(hash(sano) === '35ad0c8d8a79adf84fca38e421a46e9864cb7daf723558c489acb080233aecd2', 'HTML normalizado idéntico a origin/main');
console.log('  HTML conservado sha256:', hash(sano));
console.log(`${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
