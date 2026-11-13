// `util/solo-biblioteca.js` y dónde se piden los guardados (v=363, tanda 122). Datos INVENTADOS.
//
//   · `idsDeBiblioteca`: los items crudos `{ added_at, album }`, sin romperse con los que no traen `album` o id.
//   · `filtrarPorBiblioteca`: por id EXACTO. Otra edición del mismo disco es otro id y no cuenta. Conserva el orden de entrada.
//   · Lectura estática de `listened.js`: `getSavedAlbums` aparece SOLO dentro del manejador del chip, nunca en `render()` ni en
//     `loadAlbums()`. Abrir `#listened` no puede costar ni una petición más que antes.
//
// `RAIZ_T122` corre el test contra otra raíz: contra `f7bcabff` el módulo no existe.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = resolve(process.env.RAIZ_T122 || join(import.meta.dirname, '..'));
const { idsDeBiblioteca, filtrarPorBiblioteca } = await import(pathToFileURL(join(RAIZ, 'src/js/util/solo-biblioteca.js')).href);

let bien = 0, mal = 0;
const ok = (c, msg) => { if (c) { bien++; } else { mal++; console.error(`  ✗ ${msg}`); } };
const igual = (msg, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

// ── idsDeBiblioteca ───────────────────────────────────────────────────────────
const item = (id, name = 'Disco inventado') => ({ added_at: '2026-01-01T00:00:00Z', album: { id, name } });
const ids = idsDeBiblioteca([
  item('idAlbumInventado0001'),
  item('idAlbumInventado0002'),
  { added_at: '2026-01-01T00:00:00Z' },              // sin `album`
  { added_at: '2026-01-01T00:00:00Z', album: null },
  { added_at: '2026-01-01T00:00:00Z', album: {} },   // sin id
  item(''),
  item(null),
  null,
  undefined,
]);
ok(ids instanceof Set, 'idsDeBiblioteca devuelve un Set');
igual('solo los que traen id', [...ids], ['idAlbumInventado0001', 'idAlbumInventado0002']);
igual('una lista vacía da un Set vacío', [...idsDeBiblioteca([])], []);
igual('un id repetido cuenta una vez', [...idsDeBiblioteca([item('a'), item('a')])], ['a']);
igual('sin lista no se rompe', [...idsDeBiblioteca(undefined)], []);

// ── filtrarPorBiblioteca ──────────────────────────────────────────────────────
const NORMAL = { id: 'idDiscoNormal', name: 'Disco Inventado', artist: 'Banda Inventada' };
const DELUXE = { id: 'idDiscoDeluxe', name: 'Disco Inventado (Deluxe Edition)', artist: 'Banda Inventada' };
const OTRO = { id: 'idOtroDisco', name: 'Otro Disco', artist: 'Otra Banda' };
const TERCERO = { id: 'idTercero', name: 'Tercero', artist: 'Banda Inventada' };

igual('dos ediciones del mismo disco NO se cruzan: guardado el deluxe, el normal queda fuera',
  filtrarPorBiblioteca([NORMAL, OTRO], new Set(['idDiscoDeluxe'])), []);
igual('y al revés: guardado el normal, el deluxe queda fuera',
  filtrarPorBiblioteca([DELUXE], new Set(['idDiscoNormal'])), []);
igual('el id exacto sí cuenta', filtrarPorBiblioteca([NORMAL, DELUXE], new Set(['idDiscoDeluxe'])), [DELUXE]);
igual('el orden de entrada se conserva',
  filtrarPorBiblioteca([TERCERO, OTRO, NORMAL], new Set(['idDiscoNormal', 'idOtroDisco', 'idTercero'])).map((a) => a.id),
  ['idTercero', 'idOtroDisco', 'idDiscoNormal']);
igual('y al revés también', filtrarPorBiblioteca([NORMAL, OTRO, TERCERO], new Set(['idTercero', 'idOtroDisco', 'idDiscoNormal'])).map((a) => a.id),
  ['idDiscoNormal', 'idOtroDisco', 'idTercero']);
igual('con un Set vacío no queda ninguno', filtrarPorBiblioteca([NORMAL, OTRO], new Set()), []);
const entrada = [NORMAL, OTRO];
filtrarPorBiblioteca(entrada, new Set(['idOtroDisco']));
igual('no toca la lista que recibe', entrada, [NORMAL, OTRO]);

// ── El módulo es PURO y sin imports ───────────────────────────────────────────
const modulo = readFileSync(join(RAIZ, 'src/js/util/solo-biblioteca.js'), 'utf8');
ok(!/^\s*import\s/m.test(modulo), 'solo-biblioteca.js no importa nada');
ok(!/\b(fetch|localStorage|document|window)\b/.test(modulo.replace(/^\s*\/\/.*$/gm, '')), 'solo-biblioteca.js no toca ni la red ni el DOM');

// ── Lectura estática: los guardados, solo al apretar el chip ──────────────────
const vista = readFileSync(join(RAIZ, 'src/js/features/listened.js'), 'utf8');
/** El cuerpo de una función de primer nivel, contando llaves desde su firma. */
function cuerpoDe(fuente, firma) {
  const i = fuente.indexOf(firma);
  if (i < 0) return null;
  const abre = fuente.indexOf(') {', i) + 2;
  let n = 0;
  for (let k = abre; k < fuente.length; k++) {
    if (fuente[k] === '{') n++;
    else if (fuente[k] === '}' && --n === 0) return fuente.slice(abre, k + 1);
  }
  return null;
}
const render = cuerpoDe(vista, 'export async function render(container)');
const cargar = cuerpoDe(vista, 'async function loadAlbums(');
const manejador = cuerpoDe(vista, 'async function apretarChipBiblioteca(');
ok(render !== null, 'encontré render()');
ok(cargar !== null, 'encontré loadAlbums()');
ok(manejador !== null, 'encontré el manejador del chip');
ok(render && !render.includes('getSavedAlbums'), 'render() no pide los guardados');
ok(cargar && !cargar.includes('getSavedAlbums'), 'loadAlbums() no pide los guardados');
ok(manejador && (manejador.match(/\bgetSavedAlbums\(/g) || []).length === 1, 'el manejador los pide una vez');
// (v=366, tanda 129) «📚 Por escuchar» es el segundo sitio que la pide, también al apretar un botón (su modal la lee al abrirse). Lo que
// este guard defiende no cambió: abrir la vista (`render()`, `loadAlbums()`, `buildUI()`) no la pide. Los comentarios no cuentan.
const porEscuchar = cuerpoDe(vista, 'function openPorEscuchar(');
const buildUI = cuerpoDe(vista, 'function buildUI(');
ok(!porEscuchar || (porEscuchar.match(/\bgetSavedAlbums\(/g) || []).length === 1, '«Por escuchar», si está, la pide una vez, dentro de su modal');
ok(buildUI && !buildUI.includes('getSavedAlbums'), 'buildUI() no pide los guardados');
const sinImport = vista.replace(/^import .*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
igual('fuera de los manejadores no aparece en ningún otro sitio', (sinImport.match(/\bgetSavedAlbums\b/g) || []).length, porEscuchar ? 2 : 1);
ok(!/\/me\/albums/.test(vista.replace(/^\s*\/\/.*$/gm, '')), 'listened.js no escribe otra lectura de /me/albums');

console.log(`${bien + mal} asserts · ${bien} ok · ${mal} fallan`);
if (mal) process.exit(1);
