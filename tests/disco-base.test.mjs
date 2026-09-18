// Suite de la base de discografías (v=229), la parte pura.
//
// Lo que cuidan estas pruebas: que la base NUNCA pierda un lanzamiento (ni al
// sumar, ni al importar, ni al importar dos veces) y que la unión por id NO
// fusione discos distintos que `albumKey` flojo sí fusionaría.

import assert from 'node:assert';
import {
  unirItems, crearBase, sumarCompleta, sumarReciente, tocaReciente, rangoReciente,
  fusionarBases, armarExportacion, leerImportacion, esBaseValida,
  RECIENTE_TTL_MS, RECIENTE_FORZADO_MIN_MS, DISCO_BASE_FORMATO,
} from '../src/js/util/disco-base.js';
import { albumKey } from '../src/js/util/album-key.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const al = (id, name, extra = {}) => ({ id, name, type: 'album', img: `img-${id}`, release: '2020', total: 10, artists: [{ id: 'A', name: 'X' }], ...extra });
const ids = (items) => items.map(x => x.id).sort();

// ── 1. La unión es por id: los discos «parecidos» NO se fusionan ────────────

{
  const pares = [
    [al('af2', 'American Football (LP2)'), al('af3', 'American Football (LP3)')],
    [al('cc1', 'Crystal Castles'), al('cc2', 'Crystal Castles (II)')],
    [al('ed1', '÷'), al('ed2', '='), al('ed3', '+')],
  ];
  // Los tres casos del aviso del repo: aflojar albumKey los fusionaría. La
  // unión va por id, así que no puede.
  for (const grupo of pares) {
    const r = unirItems(grupo.slice(0, 1), grupo.slice(1));
    eq(r.items.length, grupo.length, `los ${grupo.length} de «${grupo[0].name}» siguen separados`);
    eq(r.agregados, grupo.length - 1, 'y cuentan como agregados');
  }
  // `albumKey` los separa hoy (cuatro asserts del repo lo cuidan). La unión no
  // depende de eso: aunque dos lanzamientos tuvieran el MISMO nombre, con ids
  // distintos siguen siendo dos.
  eq(albumKey('American Football (LP2)', 'X') !== albumKey('American Football (LP3)', 'X'), true, 'albumKey sigue separando LP2/LP3');
  const gemelos = unirItems([al('x1', 'Mismo nombre')], [al('x2', 'Mismo nombre')]);
  eq(gemelos.items.length, 2, 'mismo nombre, ids distintos: dos lanzamientos');
}

// ── 2. La unión no pierde nada y no duplica ─────────────────────────────────

{
  const a = [al('1', 'Uno'), al('2', 'Dos')];
  const b = [al('2', 'Dos'), al('3', 'Tres')];
  const r = unirItems(a, b);
  eq(ids(r.items), ['1', '2', '3'], 'unión de dos listas solapadas');
  eq(r.agregados, 1, 'solo el 3 es nuevo');
  eq(ids(unirItems(r.items, r.items).items), ['1', '2', '3'], 'unirse consigo misma no duplica');
}

{
  // Un campo vacío no pisa uno lleno; uno lleno sí actualiza (renombrado).
  const r = unirItems([al('1', 'Viejo nombre', { img: 'tapa' })], [al('1', 'Nombre nuevo', { img: '' })]);
  eq(r.items[0].name, 'Nombre nuevo', 'el nombre más nuevo gana (álbum renombrado)');
  eq(r.items[0].img, 'tapa', 'una respuesta sin tapa no borra la tapa');
}

// ── 3. El caso medido: ni el nativo ni /search están enteros ────────────────

{
  // Lana Del Rey, 2026-09-18: el nativo no trae lo de 2025-26; /search no trae
  // algunos singles viejos. La base tiene que tener los dos.
  const nativo = [al('n1', 'Norman Fucking Rockwell!'), al('n2', 'Lost At Sea', { type: 'single' })];
  const busqueda = [al('n1', 'Norman Fucking Rockwell!'), al('s1', 'Bluebird', { type: 'single', release: '2025-04-18' })];
  let base = crearBase(busqueda, { fuente: 'busqueda', cortada: true, t: 1000 });
  base = sumarCompleta(base, nativo, { fuente: 'nativo', cortada: false, t: 2000 });
  eq(ids(base.items), ['n1', 'n2', 's1'], 'el nativo NO reemplaza: se suma a lo de /search');
  eq(base.cortada, false, 'una pedida entera deja de marcarla cortada');
  eq(base.fuente, 'nativo', 'y la fuente pasa a ser la entera');
  eq(base.historial.length, 2, 'queda anotado de dónde salió cada cosa');
}

{
  // Una pedida cortada no empeora a una entera.
  let base = crearBase([al('1', 'A')], { fuente: 'nativo', cortada: false, t: 1 });
  base = sumarCompleta(base, [al('2', 'B')], { fuente: 'busqueda', cortada: true, t: 2 });
  eq(base.cortada, false, 'sigue entera');
  eq(base.fuente, 'nativo', 'y sigue siendo del nativo');
  eq(ids(base.items), ['1', '2'], 'pero lo que trajo la cortada se suma igual');
}

// ── 4. Lo reciente ──────────────────────────────────────────────────────────

{
  const t0 = Date.UTC(2026, 8, 3);
  let base = crearBase([al('1', 'Viejo')], { fuente: 'busqueda', cortada: true, estimada: true, t: t0 });
  eq(tocaReciente(base, { ahora: t0 + RECIENTE_TTL_MS - 1 }), false, 'antes de 30 días no toca');
  eq(tocaReciente(base, { ahora: t0 + RECIENTE_TTL_MS + 1 }), true, 'pasados 30 días toca');
  eq(tocaReciente(base, { forzar: true, ahora: t0 + RECIENTE_FORZADO_MIN_MS - 1 }), false, 'forzar no repite lo mirado hace un rato');
  eq(tocaReciente(base, { forzar: true, ahora: t0 + RECIENTE_FORZADO_MIN_MS + 1 }), true, 'forzar sí mira lo de hace más de 12 h');
  eq(rangoReciente(base, Date.UTC(2026, 9, 5)), '2025-2026', 'rango normal: año pasado-este año');
  eq(rangoReciente({ recienteAt: Date.UTC(2023, 5, 1) }, Date.UTC(2026, 9, 5)), '2023-2026', 'si pasó mucho, el rango se estira y no deja hueco');
  const t1 = t0 + RECIENTE_TTL_MS + 5;
  base = sumarReciente(base, [al('2', 'Nuevo', { release: '2026-09-10' })], { t: t1, year: '2025-2026' });
  eq(ids(base.items), ['1', '2'], 'lo reciente se suma');
  eq(base.cortada, true, 'y no cambia si la histórica estaba cortada');
  eq(base.recienteAt, t1, 'marca la hora del refresco');
  eq(tocaReciente(base, { ahora: t1 + 1 }), false, 'recién refrescada no toca');
}

// ── 5. Importar: unión, idempotente, nunca borra ────────────────────────────

{
  const mia = crearBase([al('1', 'A'), al('2', 'B')], { fuente: 'busqueda', cortada: true, t: 10 });
  const suya = crearBase([al('2', 'B'), al('3', 'C')], { fuente: 'nativo', cortada: false, t: 20 });
  const j = fusionarBases(mia, suya, 30);
  eq(ids(j.items), ['1', '2', '3'], 'importar suma sin borrar lo propio');
  eq(j.cortada, false, 'la entera del otro navegador gana a la cortada de este');
  eq(j.fuente, 'nativo', 'con su fuente');
  const j2 = fusionarBases(j, suya, 40);
  eq(ids(j2.items), ids(j.items), 'importar dos veces el mismo archivo no cambia los lanzamientos');
  const vieja = crearBase([al('1', 'A')], { fuente: 'busqueda', cortada: true, t: 1 });
  eq(ids(fusionarBases(j, vieja, 50).items), ['1', '2', '3'], 'importar uno más viejo no borra nada nuevo');
  eq(fusionarBases(null, suya), suya, 'sin base propia, la importada entra tal cual');
}

{
  const bases = {
    A: crearBase([al('1', 'A')], { fuente: 'nativo', cortada: false, t: 1 }),
    B: crearBase([al('2', 'B'), al('3', 'C')], { fuente: 'busqueda', cortada: true, t: 1 }),
  };
  const exp = armarExportacion(bases, new Date(Date.UTC(2026, 8, 18)));
  eq([exp._format, exp.artistas, exp.lanzamientos], [DISCO_BASE_FORMATO, 2, 3], 'la exportación cuenta artistas y lanzamientos');
  const ida = leerImportacion(JSON.parse(JSON.stringify(exp)));
  eq(ida.ok, true, 'lo exportado se vuelve a leer');
  eq(Object.keys(ida.bases).sort(), ['A', 'B'], 'con todas sus bases');
  eq(leerImportacion({ _format: 'spotify-tools-data', _version: 2 }).ok, false, 'el JSON de #genre no se confunde con una base');
  eq(leerImportacion({ ...exp, _version: 99 }).ok, false, 'una versión desconocida se rechaza entera');
  const sucio = leerImportacion({ ...exp, bases: { ...exp.bases, C: { items: [{ name: 'sin id' }], fuente: 'nativo' }, D: null } });
  eq([sucio.ok, Object.keys(sucio.bases).length, sucio.descartadas], [true, 2, 2], 'las entradas mal formadas se descartan y el resto entra');
  eq(esBaseValida({ items: [], fuente: 'otra' }), false, 'una fuente desconocida no es una base');
}

console.log(`disco-base: ${n} asserts OK`);
