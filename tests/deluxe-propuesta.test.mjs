// La propuesta de «solo cambia la edición del disco» de #versions (tanda 70).
//
// Lo que este test cuida NO es que se proponga mucho: es que NO se proponga
// cuando los dos miembros pueden ser grabaciones distintas. Cada condición de
// la regla tiene un caso que pasa y uno que falla, por separado, con pistas
// INVENTADAS (nada de la biblioteca de nadie). Los tres discos de
// `discover-edicion.test.mjs` que NO son ediciones están al final.
//
// Correr con: node tests/deluxe-propuesta.test.mjs

import assert from 'node:assert';
import {
  limpiarNombre, tieneMarcadorDeVersion, motivosPorNombre, motivosDeLaRegla,
  propuestaDeGrupo, TOPE_DURACION_MS,
} from '../src/js/util/deluxe-propuesta.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

// Un me gusta ficticio, con la forma del caché (`slimTrack`).
function like(id, { name = 'Canción de Prueba', artista = 'Banda Ficticia', disco = 'Disco Ficticio',
  discoId = `alb-${id}`, tipo = 'album', pistas = 10, dur = 200000, explicit = false, isrc } = {}) {
  return {
    added_at: '2025-01-01T00:00:00Z',
    track: {
      id, uri: `spotify:track:${id}`, name, duration_ms: dur, explicit,
      external_ids: isrc === undefined ? { isrc: 'XXAAA2500001' } : (isrc === null ? undefined : { isrc }),
      artists: [{ id: 'art1', name: artista }],
      album: { id: discoId, name: disco, album_type: tipo, total_tracks: pistas, release_date: '2020-01-01', images: [] },
    },
  };
}
// El par de siempre: el disco y su deluxe, el deluxe con más pistas.
const base = (o = {}) => like('t1', { disco: 'Disco Ficticio', pistas: 10, ...o });
const deluxe = (o = {}) => like('t2', { disco: 'Disco Ficticio (Deluxe Edition)', pistas: 16, ...o });

// ── 0. Las piezas sueltas ────────────────────────────────────────────────────

eq(limpiarNombre('  Canción   De\tPrueba  '), 'canción de prueba', 'minúsculas, espacios colapsados y recortados');
eq(limpiarNombre('It’s Fine'), "it's fine", 'el apóstrofo tipográfico pasa al recto');
eq(limpiarNombre('Itʼs Fine'), "it's fine", 'el modificador de letra U+02BC también');
eq(limpiarNombre('Café'), 'café', 'NFC: la tilde combinada se compone');
eq(limpiarNombre('Tema (feat. Otro)'), 'tema (feat. otro)', 'NO saca paréntesis');
eq(limpiarNombre('Tema - 2011 Remaster') === limpiarNombre('Tema'), false, 'NO saca la cola de remaster');

eq(tieneMarcadorDeVersion('Canción de Prueba'), false, 'un título limpio no tiene marcador');
eq(tieneMarcadorDeVersion('Canción - Remastered 2011'), true, 'remastered');
eq(tieneMarcadorDeVersion('Canción (Live)'), true, 'live (VERSION_MARKERS)');
eq(tieneMarcadorDeVersion("Canción (Taylor's Version)"), true, "«X's Version»");
eq(tieneMarcadorDeVersion('Canción (Album Version)'), true, 'cualquier «version»');
eq(tieneMarcadorDeVersion('Canción (Versión Acústica)'), true, 'con tildes: versión, acústica');
eq(tieneMarcadorDeVersion('CANCIÓN EN VIVO'), true, 'en vivo, en mayúsculas');
eq(tieneMarcadorDeVersion('Canción - Radio Edit'), true, 'radio edit');
eq(tieneMarcadorDeVersion('Canción (8D Audio)'), true, '8d');
eq(tieneMarcadorDeVersion('Canción (A Cappella)'), true, 'a cappella');
eq(tieneMarcadorDeVersion('Canción - Mono'), true, 'mono');
eq(tieneMarcadorDeVersion('Canción (Bonus Track)'), true, 'bonus');
eq(tieneMarcadorDeVersion('Canción (Demo)'), true, 'demo');
eq(tieneMarcadorDeVersion('Canción - Sped Up'), true, 'sped up');
eq(tieneMarcadorDeVersion('Canción (Cover)'), true, 'cover');
eq(tieneMarcadorDeVersion('Canción (Commentary)'), true, 'commentary');
eq(tieneMarcadorDeVersion('Canción - Club Mix'), true, 'mix');
eq(tieneMarcadorDeVersion('Remixer Lindo'), false, 'palabra entera: «remixer» no es «remix»');
eq(tieneMarcadorDeVersion('Monolito'), false, 'palabra entera: «monolito» no es «mono»');
eq(tieneMarcadorDeVersion('Editorial'), false, 'palabra entera: «editorial» no es «edit»');
eq(tieneMarcadorDeVersion('Livewire'), false, 'palabra entera: «livewire» no es «live»');

// ── 1. El caso que pasa ──────────────────────────────────────────────────────

{
  const p = propuestaDeGrupo([base(), deluxe()]);
  eq(p && p.queda, ['t2'], 'queda la edición de más pistas (el deluxe)');
  eq(p && p.seBorran, ['t1'], 'se borra la de menos pistas');
  eq(p && p.porque.diferenciaMs, 0, 'por qué: la diferencia de duración');
  eq(p && p.porque.explicit, false, 'por qué: ninguno es explícito');
  eq(p && p.porque.isrc, 'igual', 'por qué: el ISRC es igual');
  eq(p && p.porque.base, 'Disco Ficticio', 'por qué: la base del disco');
  eq(p && p.porque.ediciones.map(e => [e.id, e.pistas, e.queda]), [['t1', 10, false], ['t2', 16, true]], 'por qué: las pistas de cada edición');
  eq(motivosPorNombre([base(), deluxe()]), [], 'pasa por nombres');
  // El orden de los miembros no cambia la propuesta.
  eq(propuestaDeGrupo([deluxe(), base()])?.queda, ['t2'], 'simétrico: el orden del grupo no importa');
  // Los items crudos y las pistas solas dan lo mismo.
  eq(propuestaDeGrupo([base().track, deluxe().track])?.queda, ['t2'], 'acepta las pistas solas');
}

// ── 2. Cada condición, una por una ───────────────────────────────────────────

// Artista principal.
eq(propuestaDeGrupo([base(), deluxe({ artista: 'Otra Banda' })]), null, 'artista distinto → a mano');
eq(motivosPorNombre([base(), deluxe({ artista: 'Otra Banda' })]).includes('artista-distinto'), true, 'motivo: artista-distinto');
eq(propuestaDeGrupo([base(), deluxe({ artista: '  BANDA   ficticia ' })])?.queda, ['t2'], 'artista con mayúsculas/espacios: el mismo');

// Título, idéntico tras la limpieza mínima.
eq(propuestaDeGrupo([base(), deluxe({ name: 'Canción de Prueba (feat. Otro)' })]), null, 'título distinto → a mano');
eq(motivosPorNombre([base(), deluxe({ name: 'Canción de Prueba (feat. Otro)' })]).includes('titulo-distinto'), true, 'motivo: titulo-distinto');
eq(propuestaDeGrupo([base({ name: 'It’s Fine' }), deluxe({ name: "it's  fine" })])?.queda, ['t2'], 'título con apóstrofo tipográfico y mayúsculas: el mismo');

// Marcadores de versión.
{
  const g = [base(), deluxe({ name: 'Canción de Prueba - Remastered 2011' })];
  eq(propuestaDeGrupo(g), null, '«- Remastered 2011» de un lado → a mano');
  eq(motivosPorNombre(g).includes('marcador-de-version'), true, 'motivo: marcador-de-version');
  eq(motivosPorNombre(g).includes('titulo-distinto'), true, 'y además el título difiere');
}
{
  // Los dos con el MISMO marcador: el título es igual, y aun así a mano.
  const g = [base({ name: 'Canción de Prueba (Live)' }), deluxe({ name: 'Canción de Prueba (Live)' })];
  eq(propuestaDeGrupo(g), null, '«(Live)» en los dos → a mano');
  eq(motivosPorNombre(g), ['marcador-de-version'], 'solo por el marcador');
}
{
  const g = [base({ name: "Canción de Prueba (Taylor's Version)" }), deluxe({ name: "Canción de Prueba (Taylor's Version)" })];
  eq(propuestaDeGrupo(g), null, "«Taylor's Version» → a mano");
}

// Nombres de disco distintos.
{
  const g = [base({ disco: 'Disco Ficticio (Deluxe Edition)' }), deluxe()];
  eq(propuestaDeGrupo(g), null, 'el mismo nombre de disco → a mano');
  eq(motivosPorNombre(g).includes('disco-mismo-nombre'), true, 'motivo: disco-mismo-nombre');
}

// La misma baseDeEdicion.
{
  const g = [base({ disco: 'Otro Disco' }), deluxe()];
  eq(propuestaDeGrupo(g), null, 'bases distintas → a mano');
  eq(motivosPorNombre(g).includes('base-distinta'), true, 'motivo: base-distinta');
}
{
  const g = [base({ disco: 'disco ficticio' }), deluxe()];
  eq(propuestaDeGrupo(g), null, 'base exacta: «disco ficticio» contra «Disco Ficticio (Deluxe…)» → a mano');
}

// Al menos uno con agregado de edición.
{
  const g = [base({ disco: 'Disco Ficticio Uno' }), deluxe({ disco: 'Disco Ficticio Dos' })];
  eq(motivosPorNombre(g).includes('sin-agregado-de-edicion'), true, 'sin ningún agregado → motivo');
  eq(propuestaDeGrupo(g), null, 'sin ningún agregado → a mano');
}

// Apretado en la tanda 70 (mitad A): un disco de otra grabación deja el grupo a mano.
{
  const casos = [
    ['Disco Ficticio (Remastered Edition)', 'remaster en el disco'],
    ['Disco Ficticio (Remastered 2011)', 'remaster con año'],
    ['Disco Ficticio (Extended Edition)', 'extended en el disco'],
    ["Disco Ficticio (Fulano's Version)", 'versión posesiva de otro'],
    ['Disco Ficticio (Fulano’s Version)', 'versión posesiva con el apóstrofo tipográfico'],
  ];
  for (const [disco, que] of casos) {
    const g = [base(), deluxe({ disco })];
    eq(propuestaDeGrupo(g), null, `${que} → a mano`);
    eq(motivosPorNombre(g).includes('disco-de-otra-grabacion'), true, `${que} → motivo disco-de-otra-grabacion`);
  }
  eq(motivosPorNombre([base(), deluxe({ disco: 'Disco Ficticio (Deluxe Version)' })]), [], '«(Deluxe Version)» sigue pasando');
  eq(motivosPorNombre([base({ disco: 'Mono-Tonos Ficticios' }), deluxe({ disco: 'Mono-Tonos Ficticios (Deluxe)' })]), [], 'una palabra del nombre de base («Mono-…») no lo deja a mano');
}

// Ids de disco distintos.
{
  const g = [base({ discoId: 'mismo' }), deluxe({ discoId: 'mismo' })];
  eq(motivosPorNombre(g), [], 'ids iguales: por nombres pasa');
  eq(propuestaDeGrupo(g), null, 'ids de disco iguales → a mano');
  eq(motivosDeLaRegla(g).includes('disco-mismo-id'), true, 'motivo: disco-mismo-id');
}

// album_type === 'album' en todos: el single contra el álbum NO entra.
{
  const g = [base({ tipo: 'single', pistas: 1, disco: 'Disco Ficticio' }), deluxe()];
  eq(propuestaDeGrupo(g), null, 'un single contra un álbum → a mano');
  eq(motivosDeLaRegla(g).includes('no-es-album'), true, 'motivo: no-es-album');
  eq(propuestaDeGrupo([base({ tipo: 'compilation' }), deluxe()]), null, 'un recopilatorio → a mano');
}

// La duración: ≤ 2.000 ms pasa, 2.001 no.
eq(TOPE_DURACION_MS, 2000, 'el tope es 2.000 ms');
eq(propuestaDeGrupo([base({ dur: 200000 }), deluxe({ dur: 202000 })])?.porque.diferenciaMs, 2000, '2.000 ms justos → pasa');
{
  const g = [base({ dur: 200000 }), deluxe({ dur: 202001 })];
  eq(propuestaDeGrupo(g), null, '2.001 ms → a mano');
  eq(motivosDeLaRegla(g).includes('duracion-distinta'), true, 'motivo: duracion-distinta');
}
eq(propuestaDeGrupo([base({ dur: 0 }), deluxe({ dur: 0 })]), null, 'sin duración (0) → a mano');

// El mismo explicit.
{
  const g = [base({ explicit: true }), deluxe({ explicit: false })];
  eq(propuestaDeGrupo(g), null, 'explicit distinto → a mano');
  eq(motivosDeLaRegla(g).includes('explicit-distinto'), true, 'motivo: explicit-distinto');
  eq(propuestaDeGrupo([base({ explicit: true }), deluxe({ explicit: true })])?.porque.explicit, true, 'los dos explícitos → pasa y lo dice');
}

// ISRC.
{
  const g = [base({ isrc: 'XXAAA2500001' }), deluxe({ isrc: 'XXAAA2500002' })];
  eq(propuestaDeGrupo(g), null, 'ISRC distinto → a mano');
  eq(motivosDeLaRegla(g).includes('isrc-distinto'), true, 'motivo: isrc-distinto');
  eq(propuestaDeGrupo([base({ isrc: 'xxaaa2500001' }), deluxe({ isrc: 'XXAAA2500001' })])?.porque.isrc, 'igual', 'ISRC igual sin distinguir mayúsculas');
  const sinUno = propuestaDeGrupo([base({ isrc: null }), deluxe()]);
  eq(sinUno?.queda, ['t2'], 'ISRC ausente en uno → pasa igual');
  eq(sinUno?.porque.isrc, 'no-esta', 'y lo dice: no-esta');
  eq(propuestaDeGrupo([base({ isrc: '' }), deluxe({ isrc: 'XXAAA2500009' })])?.porque.isrc, 'no-esta', 'ISRC vacío cuenta como ausente');
}

// La edición que queda: la de más pistas, si es ÚNICA.
{
  const g = [base({ pistas: 12 }), deluxe({ pistas: 12 })];
  eq(propuestaDeGrupo(g), null, 'empate de pistas → null');
  eq(motivosDeLaRegla(g).includes('empate-de-pistas'), true, 'motivo: empate-de-pistas');
  eq(propuestaDeGrupo([base({ pistas: null }), deluxe()]), null, 'sin total de pistas → a mano');
}

// Grupo de tres.
{
  const tres = [
    base(),
    deluxe(),
    like('t3', { disco: 'Disco Ficticio (Super Deluxe Edition)', pistas: 30 }),
  ];
  const p = propuestaDeGrupo(tres);
  eq(p?.queda, ['t3'], 'grupo de tres: queda la de más pistas');
  eq(p?.seBorran, ['t1', 't2'], 'grupo de tres: se borran las otras dos');
  // Si UNO solo de los tres no cumple, el grupo entero a mano.
  const conUnoMalo = [...tres.slice(0, 2), like('t3', { disco: 'Disco Ficticio (Super Deluxe Edition)', pistas: 30, dur: 260000 })];
  eq(propuestaDeGrupo(conUnoMalo), null, 'grupo de tres con uno que no cumple → a mano entero');
  // Empate en el máximo entre dos de tres.
  const empate = [base(), deluxe({ pistas: 30 }), like('t3', { disco: 'Disco Ficticio (Super Deluxe Edition)', pistas: 30 })];
  eq(propuestaDeGrupo(empate), null, 'grupo de tres con empate arriba → a mano');
}

// Grupos que no son grupos.
eq(propuestaDeGrupo([base()]), null, 'uno solo → null');
eq(propuestaDeGrupo([]), null, 'vacío → null');
eq(motivosPorNombre([base()]), ['menos-de-dos'], 'motivo: menos-de-dos');
// Los fantasmas (sin metadatos) nunca.
eq(propuestaDeGrupo([base({ name: '', artista: '', disco: '' }), deluxe({ name: '', artista: '', disco: '' })]), null, 'fantasmas → null');

// ── 3. Los tres de discover-edicion.test.mjs que NO son ediciones ────────────
//
// Un disco que `baseDeEdicion` deja intacto no tiene agregado: contra su
// «original» la base es distinta y no hay propuesta.
eq(propuestaDeGrupo([base({ disco: 'American Football' }), deluxe({ disco: 'American Football (LP2)' })]), null,
  'American Football (LP2) no es una edición → null');
eq(propuestaDeGrupo([base({ disco: '÷' }), deluxe({ disco: '÷ (Deluxe)' })])?.queda, ['t2'],
  '÷ contra «÷ (Deluxe)» SÍ es una edición (el control: el símbolo no rompe nada)');
eq(propuestaDeGrupo([base({ disco: '÷' }), deluxe({ disco: '=' })]), null, '÷ contra = → null');
eq(propuestaDeGrupo([base({ disco: 'eternal sunshine' }), deluxe({ disco: 'eternal sunshine (slightly deluxe and also live)' })]), null,
  'eternal sunshine (slightly deluxe and also live) no es una edición → null');

// ── 4. La regla es UNA: propuestaDeGrupo usa motivosPorNombre ─────────────────
{
  const { readFileSync } = await import('node:fs');
  const fuente = readFileSync(new URL('../src/js/util/deluxe-propuesta.js', import.meta.url), 'utf8');
  eq(/import \{ VERSION_MARKERS \} from '\.\/versions-guard\.js'/.test(fuente), true, 'VERSION_MARKERS se importa');
  eq(/import \{ baseDeEdicion, tieneAgregadoDeEdicion \} from '\.\/edition-suffix\.js'/.test(fuente), true, 'baseDeEdicion y tieneAgregadoDeEdicion se importan');
  eq(/const NUCLEO|const EDITION_STRIP|const VERSION_MARKERS/.test(fuente), false, 'ninguna se copia');
  eq(/motivosDeLaRegla\(grupo\)[^]*?motivosPorNombre\(grupo\)/.test(fuente), true, 'la regla entera arranca por la de nombres');
  eq(/\bfetch\b|document\.|localStorage|indexedDB|Date\.now|new Date/.test(fuente), false, 'puro: sin red, DOM, reloj ni almacenamiento');
}

console.log(`deluxe-propuesta: ${n} asserts OK`);
