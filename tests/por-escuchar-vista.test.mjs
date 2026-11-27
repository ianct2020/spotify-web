// tests/por-escuchar-vista.test.mjs — «📚 Por escuchar» a pantalla completa: el buscador y el orden (v=376, tanda 139)
//
// POR QUÉ ESTA SUITE EXISTE: Ian quería «Por escuchar» como una grilla de tapas a pantalla completa, con un buscador y un orden. La
// regla de qué se ve con un texto puesto y en qué orden vive en un módulo PURO, `util/por-escuchar-vista.js`, y esta suite la mira
// con datos INVENTADOS. Lo que es de pantalla (la grilla, que escribir no rehace las tarjetas, el contraste) lo mira el caso K del
// banco `listened-biblioteca`.
//
// Qué mira:
//   · `coincide`: vacío, por álbum, por un artista que no es el primero, mayúsculas y acentos, el apóstrofo tipográfico, un nombre de
//     un solo símbolo, «contiene» y no «empieza con»;
//   · `ordenar`: los cuatro órdenes contados a mano, las tres formas de `release_date`, lo sin fecha al final en los dos sentidos, el
//     desempate (el guardado más nuevo y después el orden en que vino), un orden desconocido, que no muta, y 🔴 la CONSERVACIÓN:
//     `guardado-nuevo` sobre lo que da `pendientesDeBiblioteca()` es el mismo orden, con fechas repetidas;
//   · `textoCuenta`;
//   · lectura estática: el módulo no toca la red ni el DOM, `registro-escuchados.js` sigue sin imports, `listened.js` usa el módulo y no
//     normaliza por su cuenta, `getSavedAlbums` solo dentro de `cargar()`, y el `sha256` de cuatro funciones es el de 9a26fef.
//
// `RAIZ_T139=<carpeta>` la corre contra otra copia del repo (p. ej. 9a26fef, para verla en rojo).
//
// 🔴 Todo INVENTADO (el repo es público).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const raiz = process.env.RAIZ_T139 || repo;
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const leer = (rel) => { const p = join(raiz, rel); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };

const RUTA_VISTA = join(raiz, 'src/js/util/por-escuchar-vista.js');
let vista = {};
try { vista = await import(pathToFileURL(RUTA_VISTA).href); } catch (e) { console.log(`  (no se pudo cargar por-escuchar-vista.js: ${e.message})`); }
const registro = await import(pathToFileURL(join(raiz, 'src/js/util/registro-escuchados.js')).href);

// Llama sin tirar: contra la base el módulo no existe y cada assert tiene que dar rojo, no cortar la suite.
const llamar = (nombre, ...args) => { try { return typeof vista[nombre] === 'function' ? vista[nombre](...args) : undefined; } catch { return undefined; } };
const ids = (lista) => (Array.isArray(lista) ? lista.map((e) => e.album.id) : null);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Una entrada como las de `pendientesDeBiblioteca()`.
const E = (id, name, artistas, addedAt, release_date) => ({ addedAt, album: { id, name, artists: artistas.map((n) => ({ name: n })), release_date } });

console.log('1. las constantes');
ok(igual(vista.ORDENES_POR_ESCUCHAR, ['guardado-nuevo', 'guardado-viejo', 'lanzamiento-nuevo', 'lanzamiento-viejo']), 'ORDENES_POR_ESCUCHAR, los cuatro y en ese orden');
ok(vista.ORDEN_POR_DEFECTO === 'guardado-nuevo', 'ORDEN_POR_DEFECTO = guardado-nuevo');

console.log('2. coincide');
{
  const luna = E('l1', 'Luna de Papel Inventada', ['Banda Uno Inventada', 'Grupo Segundo Inventado'], '2026-01-01T00:00:00Z', '2020');
  const acento = E('l2', 'Álbum Inventado', ['Solista Inventada'], '2026-01-01T00:00:00Z', '2020');
  const apos = E('l3', 'Rock’n Roll Inventado', ['Otra Banda Inventada'], '2026-01-01T00:00:00Z', '2020');
  const simbolo = E('l4', '÷', ['Banda Símbolo Inventada'], '2026-01-01T00:00:00Z', '2020');
  ok(llamar('coincide', luna, '') === true, 'vacío → coincide');
  ok(llamar('coincide', luna, '   ') === true, 'solo espacios → coincide');
  ok(llamar('coincide', luna, undefined) === true, 'sin texto (undefined) → coincide');
  ok(llamar('coincide', luna, 'luna') === true, 'por el nombre del álbum');
  ok(llamar('coincide', luna, 'segundo') === true, 'por un artista que no es el primero');
  ok(llamar('coincide', luna, 'banda uno') === true, 'por el primer artista');
  ok(llamar('coincide', luna, 'zzz') === false, 'lo que no está → no coincide');
  ok(llamar('coincide', acento, 'album') === true, '«album» encuentra «Álbum»');
  ok(llamar('coincide', acento, 'ÁLBUM') === true, '«ÁLBUM» encuentra «Álbum» (mayúsculas y acento)');
  ok(llamar('coincide', apos, "rock'n") === true, 'el apóstrofo recto encuentra el tipográfico');
  ok(llamar('coincide', E('l5', "Rock'n Roll Inventado", [], '', ''), 'rock’n') === true, 'el tipográfico encuentra el recto');
  ok(llamar('coincide', simbolo, '÷') === true, 'un álbum de un solo símbolo se encuentra por el símbolo');
  ok(llamar('coincide', luna, '÷') === false, 'el símbolo NO queda vacío: no coincide con todo');
  ok(llamar('coincide', luna, 'papel') === true, '«contiene»: «papel» está en el medio');
  ok(llamar('coincide', luna, 'inventada luna') === false, 'no es «tiene todas las palabras»: el orden importa');
  ok(llamar('coincide', luna, '  luna   de ') === true, 'los espacios del texto se colapsan');
  ok(llamar('coincide', E('l6', '', [], '', ''), 'x') === false, 'un álbum sin nombre ni artistas no coincide con un texto');
}

console.log('3. ordenar');
{
  // Contados a mano. b y f se guardaron el mismo día; d sin fecha de guardado; e y f sin fecha de lanzamiento («0000» tampoco es fecha).
  const a = E('a', 'Disco A Inventado', ['X'], '2026-03-01T00:00:00Z', '2020');
  const b = E('b', 'Disco B Inventado', ['X'], '2026-02-01T00:00:00Z', '2021-05');
  const c = E('c', 'Disco C Inventado', ['X'], '2026-04-01T00:00:00Z', '2019-12-31');
  const d = E('d', 'Disco D Inventado', ['X'], '', '2022-01-01');
  const e = E('e', 'Disco E Inventado', ['X'], '2026-01-01T00:00:00Z', '');
  const f = E('f', 'Disco F Inventado', ['X'], '2026-02-01T00:00:00Z', '0000');
  const entrada = [a, b, c, d, e, f];
  const copia = JSON.stringify(entrada);
  ok(igual(ids(llamar('ordenar', entrada, 'guardado-nuevo')), ['c', 'a', 'b', 'f', 'e', 'd']), `guardado-nuevo: c a b f e d (${ids(llamar('ordenar', entrada, 'guardado-nuevo'))})`);
  ok(igual(ids(llamar('ordenar', entrada, 'guardado-viejo')), ['e', 'b', 'f', 'a', 'c', 'd']), `guardado-viejo: e b f a c d, sin fecha al final (${ids(llamar('ordenar', entrada, 'guardado-viejo'))})`);
  ok(igual(ids(llamar('ordenar', entrada, 'lanzamiento-nuevo')), ['d', 'b', 'a', 'c', 'f', 'e']), `lanzamiento-nuevo: d b a c, y los sin fecha f e al final (${ids(llamar('ordenar', entrada, 'lanzamiento-nuevo'))})`);
  ok(igual(ids(llamar('ordenar', entrada, 'lanzamiento-viejo')), ['c', 'a', 'b', 'd', 'f', 'e']), `lanzamiento-viejo: c a b d, y los sin fecha f e al final (${ids(llamar('ordenar', entrada, 'lanzamiento-viejo'))})`);
  ok(JSON.stringify(entrada) === copia, 'no muta la entrada');
  const r = llamar('ordenar', entrada, 'guardado-viejo');
  ok(Array.isArray(r) && r !== entrada, 'devuelve una copia');
  ok(igual(ids(llamar('ordenar', entrada, 'cualquiera')), ['c', 'a', 'b', 'f', 'e', 'd']), 'un orden desconocido = guardado-nuevo');
  ok(igual(ids(llamar('ordenar', entrada, undefined)), ['c', 'a', 'b', 'f', 'e', 'd']), 'sin orden = guardado-nuevo');
  ok(igual(ids(llamar('ordenar', [], 'lanzamiento-nuevo')), []), 'una lista vacía da vacía');

  // Las tres formas del mismo año: «2020» es el 15 de junio, «2020-03» el 15 de marzo, «2020-12-01» el 1 de diciembre.
  const x = E('x', 'Año Solo Inventado', ['X'], '2026-01-01T00:00:00Z', '2020');
  const y = E('y', 'Año Mes Inventado', ['X'], '2026-01-01T00:00:00Z', '2020-03');
  const z = E('z', 'Año Mes Día Inventado', ['X'], '2026-01-01T00:00:00Z', '2020-12-01');
  ok(igual(ids(llamar('ordenar', [x, y, z], 'lanzamiento-nuevo')), ['z', 'x', 'y']), 'AAAA, AAAA-MM y AAAA-MM-DD del mismo año: z x y');
  ok(igual(ids(llamar('ordenar', [x, y, z], 'lanzamiento-viejo')), ['y', 'x', 'z']), 'y al revés: y x z');
  const basura = E('w', 'Fecha Rota Inventada', ['X'], '2026-01-01T00:00:00Z', 'ab-cd');
  ok(ids(llamar('ordenar', [basura, x], 'lanzamiento-viejo'))?.[1] === 'w', 'una fecha que no se lee va al final también en «más viejos primero»');

  // El desempate: a igual lanzamiento, el guardado más nuevo; con eso empatado también, el orden en que vino.
  const p = E('p', 'Zeta Inventado', ['X'], '2026-01-01T00:00:00Z', '2018-01-01');
  const q = E('q', 'Alfa Inventado', ['X'], '2026-05-01T00:00:00Z', '2018-01-01');
  const s = E('s', 'Beta Inventado', ['X'], '2026-05-01T00:00:00Z', '2018-01-01');
  ok(igual(ids(llamar('ordenar', [p, s, q], 'lanzamiento-nuevo')), ['s', 'q', 'p']), 'desempate: el guardado más nuevo, y después el orden en que vino (no el nombre)');
  ok(igual(ids(llamar('ordenar', [p, s, q], 'lanzamiento-viejo')), ['s', 'q', 'p']), 'el desempate es el mismo en los dos sentidos');
  ok(igual(ids(llamar('ordenar', [p, q, s], 'guardado-viejo')), ['p', 'q', 's']), 'en guardado, a igual fecha, el orden en que vino');
}

console.log('4. conservación: guardado-nuevo = pendientesDeBiblioteca()');
{
  // 30 álbumes inventados, con fechas repetidas (y dos sin fecha), en un orden revuelto a mano.
  const FECHAS = ['2026-02-01T00:00:00Z', '2025-11-10T08:00:00Z', '2026-02-01T00:00:00Z', '', '2024-06-30T23:59:59Z', '2025-11-10T08:00:00Z'];
  const items = Array.from({ length: 30 }, (_, i) => ({
    added_at: FECHAS[(i * 7) % FECHAS.length],
    album: { id: `inv${String((i * 13) % 30).padStart(2, '0')}`, name: `Disco Conservado ${(i * 11) % 30}`, artists: [{ name: `Banda Conservada ${i % 4}` }], release_date: `${2000 + (i % 9)}` },
  }));
  const indice = registro.indiceDelRegistro([], (n, a) => `${n}|${a}`);
  const pend = registro.pendientesDeBiblioteca(items, indice, (n, a) => `${n}|${a}`);
  ok(pend.length === 30, `30 pendientes (${pend.length})`);
  ok(new Set(pend.map((x) => x.addedAt)).size < 30, 'hay fechas repetidas');
  ok(igual(ids(llamar('ordenar', pend, 'guardado-nuevo')), ids(pend)), 'guardado-nuevo deja exactamente el orden de pendientesDeBiblioteca()');
}

console.log('5. textoCuenta');
ok(llamar('textoCuenta', 3, 40, 'luna') === 'Con «luna»: 3 de 40.', `con texto («${llamar('textoCuenta', 3, 40, 'luna')}»)`);
ok(llamar('textoCuenta', 40, 40, '') === '', 'sin texto → vacío');
ok(llamar('textoCuenta', 40, 40, '   ') === '', 'solo espacios → vacío');
ok(llamar('textoCuenta', 0, 40, 'zzz') === 'Ningún álbum coincide con «zzz».', `N = 0 («${llamar('textoCuenta', 0, 40, 'zzz')}»)`);
ok(llamar('textoCuenta', 1, 1, 'x') === 'Con «x»: 1 de 1.', 'N = 1');
ok(llamar('textoCuenta', 1234, 1234, 'a') === 'Con «a»: 1234 de 1234.', `cuatro cifras, sin separador («${llamar('textoCuenta', 1234, 1234, 'a')}»)`);
ok(llamar('textoCuenta', 12345, 12345, 'a') === 'Con «a»: 12.345 de 12.345.', `cinco cifras, con punto («${llamar('textoCuenta', 12345, 12345, 'a')}»)`);
ok(llamar('textoCuenta', 2, 9, '  luna   llena ') === 'Con «luna llena»: 2 de 9.', 'los espacios del texto se colapsan');

console.log('6. lectura estática');
{
  const srcVista = leer('src/js/util/por-escuchar-vista.js');
  const importsVista = srcVista.split('\n').filter((l) => /^\s*import\b/.test(l));
  ok(srcVista.length > 0, 'util/por-escuchar-vista.js existe');
  ok(importsVista.length === 2 && importsVista.some((l) => l.includes("from './mb-pais.js'")) && importsVista.some((l) => l.includes("from './release-date.js'")),
    `importa solo mb-pais.js y release-date.js (${importsVista.join(' | ')})`);
  ok(srcVista.length > 0 && !/api\.js|idb\.js|\/ui\//.test(importsVista.join('\n')), 'no importa api.js, idb.js ni nada de ui/');
  ok(srcVista.length > 0 && !/\b(document|window|fetch|indexedDB|localStorage|Date\.now|new Date\()/.test(srcVista.replace(/^\s*\/\/.*$/gm, '')), 'sin DOM, red, almacenamiento ni reloj');
  ok(/export function normalizarNombre/.test(leer('src/js/util/mb-pais.js')) && /import \{ normalizarNombre \} from '\.\/mb-pais\.js'/.test(srcVista), 'normalizarNombre se importa, no se copia');

  const srcReg = leer('src/js/util/registro-escuchados.js');
  ok(srcReg.length > 0 && !srcReg.split('\n').some((l) => /^\s*import\b/.test(l)), 'registro-escuchados.js sigue sin imports');

  const srcL = leer('src/js/features/listened.js');
  const lineas = srcL.split('\n');
  const i0 = lineas.findIndex((l) => l.startsWith('function openPorEscuchar('));
  const i1 = lineas.findIndex((l, k) => k > i0 && l === '}');
  const cuerpo = i0 >= 0 ? lineas.slice(i0, i1 + 1).join('\n') : '';
  ok(/import \{[^}]*\bcoincide\b[^}]*\bordenar\b[^}]*\} from '\.\.\/util\/por-escuchar-vista\.js'/.test(srcL), 'listened.js importa coincide y ordenar del módulo nuevo');
  ok(/import \{[^}]*\btapaParaCelda\b[^}]*\} from '\.\.\/util\/cover-size\.js'/.test(srcL), 'listened.js importa tapaParaCelda (no la copia)');
  ok(cuerpo.length > 0 && !/\.normalize\(|toLowerCase\(|normalizarNombre|localeCompare/.test(cuerpo), 'openPorEscuchar() no normaliza ni compara por su cuenta');
  const c0 = cuerpo.indexOf('const cargar = async');
  const c1 = c0 >= 0 ? cuerpo.indexOf('\n  };', c0) : -1;
  const enCargar = c0 >= 0 && c1 > c0 ? cuerpo.slice(c0, c1) : '';
  ok((cuerpo.match(/getSavedAlbums/g) || []).length === 1 && enCargar.includes('getSavedAlbums({ force })'), 'getSavedAlbums solo dentro de cargar()');
  ok(cuerpo.includes('porescuchar-pantalla') && cuerpo.includes('modal-picker') && !cuerpo.includes('max-width:560px'), 'el modal lleva porescuchar-pantalla y modal-picker, sin el max-width en línea');

  // El texto de cuatro funciones, el de 9a26fef (calculado con `git show 9a26fef:src/js/util/registro-escuchados.js`).
  const BASE = {
    pendientesDeBiblioteca: '1dac60de018a46f2e279dfdb14fb74fae37a419eb0c9b355e795eb3f00408942',
    leerPorEscuchar: '338d35668c9a90f64971b97d4be4cd41aef7d8dc14424d9b5cd58847809a31eb',
    elegirPista: 'fb609edfc737af3e7180b340f0dae0f7df043e420fca7b272cfe63572f1070d7',
    marcarEscuchado: '0b622e74765aaa671f07ab55a05113fb7da9d1f4e13fdf9e29b09fc451305c96',
  };
  const lr = srcReg.split('\n');
  for (const [nombre, esperado] of Object.entries(BASE)) {
    const a = lr.findIndex((l) => new RegExp(`^export (async )?function ${nombre}\\(`).test(l));
    const b = lr.findIndex((l, k) => k > a && l === '}');
    const t = a >= 0 ? lr.slice(a, b + 1).join('\n') : '';
    ok(t && sha(t) === esperado, `${nombre}: el mismo sha256 que en 9a26fef (${t ? sha(t).slice(0, 12) : 'no está'}…)`);
  }
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
