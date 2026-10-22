// tests/postal-anio.test.mjs — la postal del año: textos, recorte, posiciones y contraste (v=326, tanda 73;
// rediseñada en v=327, tanda 74)
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// La postal es una imagen que circula SOLA: no lleva el ⓘ de la vista, ni el aviso del corte de los
// saltos, ni la posibilidad de abrir la ficha y ver de dónde sale un número. Lo que se equivoque ahí no
// lo corrige nadie. Por eso la parte que decide QUÉ dice y DÓNDE va (`src/js/util/postal-anio.js`) es pura
// y se prueba acá, en Node, con años INVENTADOS (2029, 2030, 2031: ningún número es de nadie):
//
//   1. el rango sale con `fmtDia` (el día que dice el dato): un año que arranca `…-01-01T00:00:28Z` dice
//      «1 ene», nunca «31 dic» — el bug de v=231, que en UTC−3 corre la primera escucha al año anterior.
//      Con `TZ` fijada a Buenos Aires: en una máquina en UTC el bug no se ve;
//   2. los números con `toLocaleString('es-ES')` (12.345 y 1234) y los minutos con el `fmtMinutes` QUE SE
//      LE PASA (uno de mentira acá): la postal no escribe su propio formateador;
//   3. 🔴 ningún texto dice «skip», «salt» ni lleva un porcentaje: antes del 15/10/2022 el export no anotaba
//      los saltos igual, y una imagen suelta no puede llevar el aviso;
//   4. el recorte con «…», con una medida de mentira (1 px por carácter): lo que entra no se toca, lo que
//      no entra termina en «…» y NUNCA pasa del máximo, y un nombre vacío no rompe;
//   4b. (v=327) los nombres de disco en hasta DOS renglones, partidos por palabra (`partir`): uno que en
//      la v=326 terminaba en «…» ahora entra entero, y uno larguísimo lleva el «…» en el segundo;
//   5. con menos de 5 artistas o discos salen los que hay, sin filas vacías ni huecos;
//   6. ninguna caja se sale de 1080×1350 ni se pisa con otra;
//   7. el contraste del texto contra lo que tiene detrás, en los cuatro `PRESETS`, ≥ 4,5:1 (la cuenta de
//      `tema-contraste.test.mjs`, la misma fórmula), y solo `--color-text` y `--color-text-secondary`.
//      🔴 (v=327) El texto que va sobre el DEGRADÉ se mide contra el PUNTO PEOR del degradé detrás de su
//      caja (renglón por renglón, con los colores redondeados a 8 bits como los pinta el lienzo), no contra
//      el promedio; y el degradé existe de verdad (la mezcla no se fue a cero para pasar);
//   8. la tapa, de 300 (y el disco 1, de al menos 360 de lado); y las 45 tapas del JSON del repo tienen la
//      forma del CDN (contadas sin red y sin nombres);
//   9. el aviso del final.
//
// Contra v=325 da rojo porque el módulo no existe; contra v=326, por el diseño (dos renglones, la tapa
// grande, el degradé).

process.env.TZ = 'America/Argentina/Buenos_Aires';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const salir = () => {
  if (fallos.length) {
    console.error(`\n✗ postal-anio: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
    for (const f of fallos) console.error('  · ' + f);
    process.exit(1);
  }
  console.log(`${ok} asserts OK`);
};

// El reloj de la máquina tiene que estar en UTC−3 para que el caso del 1 de enero muerda.
af(new Date('2031-01-01T00:00:28Z').getDate() === 31, 'la TZ de la prueba es UTC−3 (el 1 ene 00:00:28Z cae el 31 en local)');

// theme-panel.js importa DOM (modal-stack, toast…). Con este mínimo carga en Node: es el mismo andamio
// de `tema-contraste.test.mjs`, que lo único que necesita de él es `PRESETS`.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
  body: {}, querySelector: () => null, getElementById: () => null,
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.window = globalThis;

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PRESETS } = await import('../src/js/ui/theme-panel.js');
const { fmtDia } = await import('../src/js/util/fecha.js');
const { coverVariant } = await import('../src/js/util/album-key.js');
let P;
try {
  P = await import('../src/js/util/postal-anio.js');
} catch (e) {
  af(false, `src/js/util/postal-anio.js no carga: ${e.message}`);
  salir();
}
const { planPostal, textosPostal, recortar, avisoPostal, ANCHO, ALTO } = P;
const partir = typeof P.partir === 'function' ? P.partir : null;
const degradadoPostal = typeof P.degradadoPostal === 'function' ? P.degradadoPostal : null;
af(partir, 'postal-anio.js exporta `partir` (los nombres en dos renglones)');
af(degradadoPostal, 'postal-anio.js exporta `degradadoPostal` (el fondo con el degradé del tema)');

// ── Los años INVENTADOS ─────────────────────────────────────────────────────
const fmtMentira = (m) => `MIN[${m}]`;
const porLetra = (t) => [...String(t)].length;           // 1 px por carácter
const ancha = (t) => [...String(t)].length * 20;         // 20 px por carácter: para que el recorte muerda en la postal
// Medio tamaño de letra por carácter: se parece a la letra de verdad (Inter mide 0,5-0,6 em por carácter).
const proporcional = (t, f) => [...String(t)].length * f.tam * 0.5;
const IMG = (k) => `https://i.scdn.co/image/ab67616d0000b273${String(k).padStart(24, '0')}`;

function anio(over = {}) {
  return {
    year: 2031, min: 98765, plays: 12345, days_active: 1234, longest_streak: 12345,
    skip_pct: 41.7, skips: 999, plays_raw: 13000,
    first_play: '2031-01-01T00:00:28Z', last_play: '2031-12-31T01:10:00Z',
    peak_day: { date: '2031-03-09', min: 668 },
    top_artists: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Artista inventado ${i}`, min: 1000 - i * 100, plays: 50 - i })),
    top_albums: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `Disco inventado ${i}`, artist: `Artista inventado ${i}`, min: 500 - i * 10, plays: 30 - i, img: IMG(i) })),
    ...over,
  };
}
const ctxMentira = { fmtMinutes: fmtMentira, fmtDia, medir: (t) => porLetra(t) };
const textos = (plan) => plan.textos.map((t) => t.texto);
const de = (plan, id) => plan.textos.find((t) => t.id === id);
/** El nombre del disco k entero, uniendo sus renglones (`disco-nombre-k` y `disco-nombre-k-b`). */
const renglonesDe = (plan, base) => plan.textos.filter((t) => t.id === base || t.id === `${base}-b`).map((t) => t.texto);

// ── 1 · el rango, con fmtDia ────────────────────────────────────────────────
{
  const p = planPostal(anio(), ctxMentira);
  const r = de(p, 'rango')?.texto;
  af(r === 'del 1 ene 2031 al 31 dic 2031', `rango de un año que arranca 00:00:28Z y termina 01:10Z: «${r}»`);
  af(!textos(p).some((t) => /31 dic 2030|30 dic 2031/.test(t)), 'ningún texto corre el día a la hora local (ni «31 dic 2030» ni «30 dic 2031»)');
  af(de(p, 'anio')?.texto === '2031', 'el año, grande, tal cual');
  const medio = planPostal(anio({ year: 2029, first_play: '2029-08-15T14:00:00Z', last_play: '2029-12-31T20:00:00Z' }), ctxMentira);
  af(de(medio, 'rango')?.texto === 'del 15 ago 2029 al 31 dic 2029', `un año que empieza a mitad: «${de(medio, 'rango')?.texto}»`);
  const corto = planPostal(anio({ year: 2030, first_play: '2030-01-01T00:00:01Z', last_play: '2030-08-27T02:00:00Z' }), ctxMentira);
  af(de(corto, 'rango')?.texto === 'del 1 ene 2030 al 27 ago 2030', `un año que termina antes del 31/12: «${de(corto, 'rango')?.texto}»`);
  // El día pico es una casilla más de la franja de datos: el día con fmtDia y sus minutos en la etiqueta.
  af(de(p, 'dato-pico')?.texto === '9 mar 2031', `el día pico con fmtDia: «${de(p, 'dato-pico')?.texto}»`);
  af(de(p, 'dato-pico-et')?.texto === 'día pico · MIN[668]', `y sus minutos con el fmtMinutes pasado: «${de(p, 'dato-pico-et')?.texto}»`);
}

// ── 2 · los números, y los minutos con el fmtMinutes que se le pasa ─────────
{
  const p = planPostal(anio(), ctxMentira);
  const t = textos(p);
  af(de(p, 'heroe')?.texto === 'MIN[98765]', `los minutos del año (el número héroe) salen del fmtMinutes pasado: «${de(p, 'heroe')?.texto}»`);
  af(de(p, 'heroe-et')?.texto === 'de música', `debajo, «de música»: «${de(p, 'heroe-et')?.texto}»`);
  af(de(p, 'dato-reproducciones')?.texto === '12.345', `reproducciones con es-ES: «${de(p, 'dato-reproducciones')?.texto}»`);
  af(de(p, 'dato-dias')?.texto === '1234', `días con música con es-ES (cuatro cifras sin separador): «${de(p, 'dato-dias')?.texto}»`);
  af(de(p, 'dato-racha')?.texto === '12.345 días', `la racha con es-ES y «días»: «${de(p, 'dato-racha')?.texto}»`);
  af(de(p, 'dato-reproducciones-et')?.texto === 'reproducciones', 'la etiqueta: «reproducciones»');
  af(de(p, 'dato-dias-et')?.texto === 'días con música', 'la etiqueta: «días con música»');
  af(de(p, 'dato-racha-et')?.texto === 'la racha más larga', `la etiqueta de la racha: «${de(p, 'dato-racha-et')?.texto}»`);
  // El héroe es EL número: más grande que cualquier otro texto salvo el año, y que todos los de la franja.
  const heroe = de(p, 'heroe');
  const otros = p.textos.filter((x) => !['heroe', 'anio'].includes(x.id));
  af(heroe && otros.every((x) => x.fuente.tam < heroe.fuente.tam), `el número héroe tiene la letra más grande de la postal fuera del año (${heroe?.fuente.tam} px)`);
  const franja = p.textos.filter((x) => /^dato-/.test(x.id));
  af(franja.length === 8 && new Set(franja.filter((x) => !/-et$/.test(x.id)).map((x) => x.y)).size === 1, `los cuatro datos chicos van en UNA franja: el mismo renglón (${[...new Set(franja.map((x) => x.y))].join(', ')})`);
  for (let i = 0; i < 5; i++) {
    af(de(p, `artista-min-${i}`)?.texto === `MIN[${1000 - (i + 1) * 100}]`, `los minutos del artista ${i + 1} con el fmtMinutes pasado`);
  }
  af(!t.some((x) => /\d+h \d+m/.test(x)), 'ningún texto trae minutos con otro formateador («Nh Mm»)');
  const uno = planPostal(anio({ plays: 1, days_active: 1, longest_streak: 1 }), ctxMentira);
  af(de(uno, 'dato-reproducciones-et')?.texto === 'reproducción' && de(uno, 'dato-dias-et')?.texto === 'día con música' && de(uno, 'dato-racha')?.texto === '1 día', 'en singular con 1: «reproducción», «día con música», «1 día»');
  // `textosPostal` es lo mismo, sin posiciones: lo que usa `planPostal`.
  const tx = textosPostal(anio(), { fmtMinutes: fmtMentira, fmtDia });
  af(tx.rango === 'del 1 ene 2031 al 31 dic 2031' && tx.artistas.length === 5 && tx.discos.length === 5, 'textosPostal: el rango y cinco y cinco');
  af(tx.pie === 'Fonoteca · 2031' && de(p, 'pie')?.texto === 'Fonoteca · 2031', `abajo, «Fonoteca» y el año: «${de(p, 'pie')?.texto}»`);
}

// ── 3 · sin saltos ──────────────────────────────────────────────────────────
{
  for (const y of [anio(), anio({ year: 2022 }), anio({ year: 2018, skip_pct: 64.2 })]) {
    const t = textos(planPostal(y, { fmtMinutes: (m) => `${m} min`, fmtDia, medir: porLetra }));
    af(!t.some((x) => /skip|salt|%/i.test(x)), `${y.year}: ningún texto dice «skip», «salt» ni lleva «%» (${t.filter((x) => /skip|salt|%/i.test(x)).join(' | ')})`);
  }
}

// ── 4 · el recorte, con 1 px por carácter ───────────────────────────────────
{
  af(recortar('abcde', 5, porLetra) === 'abcde', 'un texto que entra justo no se toca');
  af(recortar('abcd', 5, porLetra) === 'abcd', 'uno que sobra tampoco');
  const r = recortar('abcdef', 5, porLetra);
  af(r.endsWith('…') && porLetra(r) <= 5 && r === 'abcd…', `uno que no entra termina en «…» y no pasa del máximo: «${r}»`);
  af(recortar('', 5, porLetra) === '', 'un nombre vacío no rompe');
  af(recortar(null, 5, porLetra) === '' && recortar(undefined, 5, porLetra) === '', 'ni uno nulo');
  af(recortar('abc', 0, porLetra) === '', 'con máximo 0 no sale nada (ni el «…», que no entra)');
  af(recortar('abc', 1, porLetra) === '…', 'con máximo 1, solo el «…»');
  af(recortar('ab   cdef', 6, porLetra) === 'ab…', `no deja un espacio colgando antes del «…»: «${recortar('ab   cdef', 6, porLetra)}»`);
  af(recortar('🎵🎵🎵🎵', 3, porLetra) === '🎵🎵…', 'no parte un carácter de dos unidades por la mitad');
  // Barrido: ningún resultado pasa del máximo, con cualquier largo y cualquier medida.
  let pasa = 0, prob = 0;
  for (let n = 0; n < 40; n++) {
    const s = 'x'.repeat(n) + 'Ñandú inventado';
    for (let max = 0; max < 60; max++) {
      for (const medir of [porLetra, (t) => [...t].reduce((a, c) => a + (c === '…' ? 3 : c === 'x' ? 1 : 2), 0)]) {
        prob++;
        const r2 = recortar(s, max, medir);
        if (medir(r2) <= max && (medir(s) <= max ? r2 === s : (r2 === '' || r2.endsWith('…')))) pasa++;
      }
    }
  }
  af(pasa === prob, `barrido del recorte: ${pasa} de ${prob} dentro del máximo y con «…» cuando corta`);
  // En la postal: con 20 px por carácter el nombre largo se corta y ningún texto pasa de su caja.
  const largo = 'Orquesta Imaginaria de los Martes por la Tarde y Sus Amigos Ficticios del Barrio';
  const y = anio({ top_artists: [{ name: largo, min: 900, plays: 1 }, ...anio().top_artists.slice(1)], top_albums: [{ name: largo, artist: largo, min: 1, plays: 1, img: IMG(1) }] });
  const p = planPostal(y, { fmtMinutes: fmtMentira, fmtDia, medir: ancha });
  // v=327: el artista 1 va en hasta dos renglones, y el «…» lo lleva el último.
  const ra = renglonesDe(p, 'artista-nombre-0'), a0 = de(p, 'artista-nombre-0-b') || de(p, 'artista-nombre-0');
  af(ra.length === 2 && a0.texto.endsWith('…') && ancha(a0.texto) <= a0.max, `el nombre largo del artista va en dos renglones, termina en «…» y entra (${JSON.stringify(ra)})`);
  const r0 = renglonesDe(p, 'disco-nombre-0');
  af(r0.length === 2 && r0[1].endsWith('…') && !r0[0].endsWith('…') && de(p, 'disco-artista-0')?.texto.endsWith('…'), `el nombre largo del disco va en dos renglones con el «…» en el segundo, y su artista también se corta (${JSON.stringify(r0)})`);
  const pasados = p.textos.filter((t) => ancha(t.texto) > t.max);
  af(pasados.length === 0, `ningún texto pasa de su máximo con 20 px por carácter: ${pasados.map((t) => t.id).join(', ')}`);
  const vacio = planPostal(anio({ top_artists: [{ name: '', min: 5, plays: 1 }], top_albums: [{ name: '', artist: '', min: 1, plays: 1 }] }), ctxMentira);
  af(de(vacio, 'artista-nombre-0')?.texto === '—' && de(vacio, 'disco-nombre-0')?.texto === '—', 'un artista o un disco sin nombre sale como «—», no como un hueco');
}

// ── 4b · los nombres en DOS renglones (v=327) ───────────────────────────────
if (partir) {
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  af(igual(partir('abc', 5, porLetra), ['abc']), 'un nombre que entra en un renglón va en uno, tal cual');
  af(igual(partir('', 5, porLetra), []) && igual(partir(null, 5, porLetra), []), 'uno vacío o nulo: ningún renglón');
  af(igual(partir('Disco Inventado Cuatro', 16, porLetra), ['Disco Inventado', 'Cuatro']), `partido por palabra: ${JSON.stringify(partir('Disco Inventado Cuatro', 16, porLetra))}`);
  // El caso de la v=326: con el mismo máximo, `recortar` lo dejaba en «Disco Inventado…» y ahora entra entero.
  af(recortar('Disco Inventado Cuatro', 16, porLetra).endsWith('…'), 'la v=326 (un renglón) lo cortaba con «…»');
  const largo = 'Orquesta Imaginaria de los Martes por la Tarde';
  const l = partir(largo, 16, porLetra);
  af(l.length === 2 && l[1].endsWith('…') && !l[0].endsWith('…') && l.every((x) => porLetra(x) <= 16), `uno larguísimo: dos renglones, el «…» en el segundo y ninguno pasa del máximo (${JSON.stringify(l)})`);
  af(l[0] === 'Orquesta' && l[1].startsWith('Imaginaria'), 'el primer renglón termina en una palabra entera');
  const palabrota = partir('Supercalifragilístico', 8, porLetra);
  af(palabrota.length === 2 && palabrota[0] === 'Supercal' && palabrota[1].endsWith('…') && palabrota.every((x) => porLetra(x) <= 8), `una sola palabra que no entra: se parte por caracteres (${JSON.stringify(palabrota)})`);
  af(igual(partir('abc def', 3, porLetra), ['abc', 'def']), 'dos palabras justas: una por renglón, sin «…»');
  af(igual(partir('🎵🎵🎵 🎵🎵🎵', 3, porLetra), ['🎵🎵🎵', '🎵🎵🎵']), 'un emoji no se parte');
  af(igual(partir('abc def', 3, porLetra, 1), ['ab…']), 'con un renglón, es el recorte de siempre');
  // Barrido: ≤ 2 renglones, ninguno pasa del máximo, el «…» solo al final del último, sin «…» las palabras
  // son las del nombre, en orden, y vacío solo cuando ni el «…» entra.
  let pasa = 0, prob = 0;
  const frases = ['Disco Inventado', 'Un Disco Con Un Nombre Bastante Largo Para Dos Renglones', 'Ñandú', 'a b c d e f g h', 'Palabraenormesinespacios y otra', '  con espacios   de más  '];
  for (const s of frases) for (let max = 1; max < 40; max++) for (const medir of [porLetra, (t) => [...t].reduce((a, c) => a + (c === '…' ? 3 : c === ' ' ? 1 : 2), 0)]) {
    prob++;
    const r = partir(s, max, medir);
    const sinElipsis = !r.some((x) => x.includes('…'));
    // Vacío solo si ni el «…» entra (como `recortar`): nunca un nombre cortado sin avisar.
    const okR = r.length === 0 ? medir('…') > max : r.length <= 2 && r.every((x) => medir(x) <= max) && r.slice(0, -1).every((x) => !x.endsWith('…'))
      && (!sinElipsis || r.join('').replace(/\s+/g, '') === s.replace(/\s+/g, ''));
    if (okR) pasa++;
  }
  af(pasa === prob, `barrido de los dos renglones: ${pasa} de ${prob}`);

  // En la postal, con una medida que se parece a la letra (medio tamaño por carácter): «Disco Inventado 2»
  // en una tapa chica no entraba en un renglón y entra entero en dos.
  const p = planPostal(anio({ top_albums: [1, 2, 3, 4, 5].map((i) => ({ name: `Disco Inventado ${i}`, artist: 'Banda', min: 1, plays: 1, img: IMG(i) })) }), { fmtMinutes: fmtMentira, fmtDia, medir: proporcional });
  for (const k of [1, 2, 3, 4]) {
    const r = renglonesDe(p, `disco-nombre-${k}`);
    const t = de(p, `disco-nombre-${k}`);
    af(r.join(' ') === `Disco Inventado ${k + 1}` && !r.some((x) => x.includes('…')), `disco ${k + 1}: «Disco Inventado ${k + 1}» entra entero en ${r.length} renglón(es) (${JSON.stringify(r)})`);
    af(t && proporcional(`Disco Inventado ${k + 1}`, t.fuente) > t.max, `disco ${k + 1}: y en un solo renglón NO entraba (${t && proporcional(`Disco Inventado ${k + 1}`, t.fuente)} > ${t?.max}): es el caso que la v=326 cortaba`);
  }
  // Nombre y artista nunca más anchos que su tapa (los discos 2 a 5; el 1 tiene la columna de al lado).
  const malos = p.tapas.slice(1).filter((tp) => p.textos.filter((t) => new RegExp(`^disco-(nombre|artista)-${tp.i}(-b)?$`).test(t.id)).some((t) => t.max > tp.lado));
  af(malos.length === 0, `discos 2 a 5: nombre y artista no más anchos que su tapa (${malos.map((t) => t.i + 1).join(', ')})`);
}

// ── 5 · menos de 5 ──────────────────────────────────────────────────────────
{
  const chico = anio({ top_artists: anio().top_artists.slice(0, 2), top_albums: anio().top_albums.slice(0, 3) });
  const p = planPostal(chico, ctxMentira);
  const nombres = p.textos.filter((t) => /^artista-nombre-/.test(t.id));
  af(nombres.length === 2, `con 2 artistas, 2 filas (${nombres.length})`);
  af(p.tapas.length === 3 && p.textos.filter((t) => /^disco-nombre-\d$/.test(t.id)).length === 3, `con 3 discos, 3 tapas y 3 nombres (${p.tapas.length})`);
  af(!p.textos.some((t) => t.texto === ''), 'ningún texto vacío (ninguna fila sin nada)');
  // El 1, grande; los otros dos, chicos, uno al lado del otro y desde la izquierda de su columna: sin huecos.
  const [t0, t1, t2] = p.tapas;
  af(t0.lado > t1.lado && t1.lado === t2.lado, `el disco 1 es el grande y los otros dos son iguales (${t0.lado}, ${t1.lado}, ${t2.lado})`);
  const completo = planPostal(anio(), ctxMentira);
  af(t1.x === completo.tapas[1].x && t2.x === completo.tapas[2].x && t1.y === completo.tapas[1].y, 'con 3 discos, el 2 y el 3 van donde van con 5 (desde la izquierda, sin huecos)');
  const sinDiscos = planPostal(anio({ top_albums: [] }), ctxMentira);
  af(sinDiscos.tapas.length === 0 && !de(sinDiscos, 'discos-titulo') && !sinDiscos.textos.some((t) => /^disco-/.test(t.id)), 'sin discos no hay tapas ni título de discos (ni un título sobre nada)');
  const sinNada = planPostal(anio({ top_albums: undefined, top_artists: undefined, peak_day: null }), ctxMentira);
  af(sinNada && de(sinNada, 'dato-pico')?.texto === '—' && de(sinNada, 'dato-pico-et')?.texto === 'día pico' && !de(sinNada, 'artistas-titulo') && !sinNada.textos.some((t) => /^artista-/.test(t.id)), 'sin listas ni día pico no revienta: «—» en el día pico y sin artistas');
  const sinImg = planPostal(anio({ top_albums: [{ name: 'Disco sin tapa', artist: 'X', min: 1, plays: 1 }] }), ctxMentira);
  af(sinImg.tapas.length === 1 && sinImg.tapas[0].url === null, 'un disco sin `img` lleva url null (la vista le pone el ♪)');
}

// ── 6 · las posiciones ──────────────────────────────────────────────────────
function cajasDe(p) {
  return [
    ...p.textos.map((t) => ({ id: t.id, ...t.caja })),
    ...p.tapas.map((t) => ({ id: `tapa-${t.i}`, x: t.x, y: t.y, w: t.lado, h: t.lado })),
    ...p.barras.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
  ];
}
const pisa = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const largoX = 'Orquesta Imaginaria de los Martes por la Tarde y Sus Amigos Ficticios del Barrio';
for (const [que, y, medir] of [
  ['el año entero', anio(), porLetra],
  ['con 20 px por carácter', anio(), ancha],
  ['con medio tamaño por carácter', anio(), proporcional],
  ['nombres larguísimos', anio({ top_artists: anio().top_artists.map((a) => ({ ...a, name: largoX })), top_albums: anio().top_albums.map((a) => ({ ...a, name: largoX, artist: largoX })) }), proporcional],
  ['2 artistas y 3 discos', anio({ top_artists: anio().top_artists.slice(0, 2), top_albums: anio().top_albums.slice(0, 3) }), ancha],
]) {
  const p = planPostal(y, { fmtMinutes: fmtMentira, fmtDia, medir });
  af(p.ancho === 1080 && p.alto === 1350 && ANCHO === 1080 && ALTO === 1350, `${que}: el lienzo es de 1080×1350`);
  const todas = [...cajasDe(p), ...p.fondos];
  const fuera = todas.filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > 1080 || c.y + c.h > 1350 || !(c.w >= 0 && c.h > 0));
  af(fuera.length === 0, `${que}: ninguna caja se sale de 1080×1350 (${fuera.map((c) => c.id).join(', ')})`);
  const c = cajasDe(p);
  const pisadas = [];
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) if (pisa(c[i], c[j])) pisadas.push(`${c[i].id}×${c[j].id}`);
  af(pisadas.length === 0, `${que}: ningún texto, tapa ni barra se pisa con otro (${pisadas.join(', ')})`);
  const fp = [];
  for (let i = 0; i < p.fondos.length; i++) for (let j = i + 1; j < p.fondos.length; j++) if (pisa(p.fondos[i], p.fondos[j])) fp.push(`${p.fondos[i].id}×${p.fondos[j].id}`);
  af(fp.length === 0, `${que}: las cajas de fondo no se pisan (${fp.join(', ')})`);
  af(p.fondos.length === 0, `${que}: sin cajas de --color-surface (la planilla eran tres cajas apiladas)`);
  // Cada texto está donde dice que está: sobre el degradé, dentro de su franja; sobre el fondo, fuera de ella.
  af(p.degradado && p.degradado.y1 > p.degradado.y0, `${que}: el plan dice dónde va el degradé`);
  const d = p.degradado || { y0: 0, y1: 0 };
  const malSobre = p.textos.filter((t) => (t.sobre === 'degradado' ? !(t.caja.y >= d.y0 && t.caja.y + t.caja.h <= d.y1) : t.sobre === 'bg' ? t.caja.y < d.y1 : true));
  af(malSobre.length === 0, `${que}: cada texto está sobre el fondo que declara (${malSobre.map((t) => `${t.id}:${t.sobre}`).join(', ')})`);
  af(p.tapas.every((t) => t.y >= d.y1), `${que}: ninguna tapa sobre el degradé`);
  af(p.tapas.every((t) => t.nota && t.nota.texto === '♪' && t.nota.sobre === 'elevated'), `${que}: cada tapa trae su ♪ por si no baja (sobre --color-elevated)`);
  const pasados = p.textos.filter((t) => medir(t.texto, t.fuente) > t.max);
  af(pasados.length === 0, `${que}: ningún texto pasa de su máximo (${pasados.map((t) => t.id).join(', ')})`);
}

// ── 7 · el contraste, en los cuatro presets ─────────────────────────────────
// La cuenta de WCAG 2.x, la MISMA de `tests/tema-contraste.test.mjs` (y de `mapa-mundo.test.mjs`): no
// es otra fórmula, es la de allá reusada. Los colores del tema son opacos: no hay alfa que componer.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
// El color del degradé a la altura `y` (en el centro del píxel, como el lienzo), redondeado a 8 bits:
// interpolado entre las paradas en sRGB, igual que `createLinearGradient`. Lo calcula ESTE test, no el
// módulo: si el módulo se equivocara en la cuenta, esto no lo copia.
function colorEn(deg, y) {
  const t = Math.min(1, Math.max(0, (y + 0.5 - deg.y0) / (deg.y1 - deg.y0)));
  const ps = deg.paradas;
  let k = 0;
  while (k < ps.length - 2 && t > ps[k + 1].t) k++;
  const a = ps[k], b = ps[k + 1];
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return hex(rgb(a.color).map((v, i) => v + (rgb(b.color)[i] - v) * u));
}
/** El PEOR contraste de un texto contra el degradé, renglón por renglón de su caja. */
function peorSobreDegrade(deg, caja, color) {
  let min = Infinity, donde = null;
  for (let y = Math.floor(caja.y); y < Math.ceil(caja.y + caja.h); y++) {
    const r = contraste(color, colorEn(deg, y));
    if (r < min) { min = r; donde = y; }
  }
  return { min, donde };
}
const TOKEN = { text: '--color-text', secondary: '--color-text-secondary', bg: '--color-bg', surface: '--color-surface', elevated: '--color-elevated' };
const coloresDe = (pr) => ({ bg: pr.colors['--color-bg'], accent: pr.colors['--color-accent'], text: pr.colors['--color-text'], secondary: pr.colors['--color-text-secondary'], elevated: pr.colors['--color-elevated'] });
const peores = {};
{
  const p = planPostal(anio(), ctxMentira);
  const pares = [...p.textos.map((t) => [t.id, t.color, t.sobre, t.caja]), ...p.tapas.map((t) => [`nota-${t.i}`, t.nota.color, t.nota.sobre, null])];
  af(pares.every(([, c]) => c === 'text' || c === 'secondary'), `solo --color-text y --color-text-secondary para el texto (${[...new Set(pares.map(([, c]) => c))].join(', ')})`);
  af(PRESETS.length === 4, `cuatro presets (${PRESETS.length})`);
  af(pares.some(([, , s]) => s === 'degradado') && pares.some(([, , s]) => s === 'bg'), 'hay texto sobre el degradé y texto sobre el fondo liso');
  for (const pr of PRESETS) {
    const col = coloresDe(pr);
    const deg = degradadoPostal ? degradadoPostal(p, col) : null;
    const bajos = [];
    let min = Infinity, minDeg = Infinity, peorDeg = '';
    for (const [id, c, s, caja] of pares) {
      let r;
      if (s === 'degradado') {
        if (!deg) { bajos.push(`${id} sin degradé`); continue; }
        const w = peorSobreDegrade(deg, caja, pr.colors[TOKEN[c]]);
        r = w.min;
        if (r < minDeg) { minDeg = r; peorDeg = `${id} en y=${w.donde}`; }
      } else r = contraste(pr.colors[TOKEN[c]], pr.colors[TOKEN[s]]);
      min = Math.min(min, r);
      if (!(r >= 4.5)) bajos.push(`${id} ${r.toFixed(2)}`);
    }
    af(bajos.length === 0, `${pr.id}: todo el texto de la postal ≥ 4,5:1 contra lo que tiene detrás, el degradé en su punto PEOR (mínimo ${min.toFixed(2)}): ${bajos.join(', ')}`);
    if (!deg) continue;
    peores[pr.id] = { mezcla: deg.mezcla, minDeg, peorDeg, min };
    // El degradé existe de verdad: no se «pasó» bajando la mezcla a cero.
    af(deg.mezcla >= 0.3, `${pr.id}: el degradé lleva el acento de verdad (mezcla ${deg.mezcla} ≥ 0,3)`);
    af(deg.paradas.at(-1).color.toLowerCase() === pr.colors['--color-bg'].toLowerCase(), `${pr.id}: el degradé termina en --color-bg (${deg.paradas.at(-1).color})`);
    af(deg.paradas[0].color.toLowerCase() !== pr.colors['--color-bg'].toLowerCase(), `${pr.id}: y arriba no es el fondo liso (${deg.paradas[0].color})`);
    // Ningún color escrito a mano: cada parada está, canal por canal, entre --color-bg y --color-accent.
    const [bg, ac] = [rgb(pr.colors['--color-bg']), rgb(pr.colors['--color-accent'])];
    af(deg.paradas.every((q) => rgb(q.color).every((v, i) => v >= Math.min(bg[i], ac[i]) - 1 && v <= Math.max(bg[i], ac[i]) + 1)), `${pr.id}: las paradas son el acento mezclado con el fondo, nada más (${deg.paradas.map((q) => q.color).join(' → ')})`);
    // Fuerte arriba y suave abajo: la mezcla no crece hacia abajo.
    const dist = deg.paradas.map((q) => contraste(q.color, pr.colors['--color-bg']));
    af(dist.every((v, i) => i === 0 || v <= dist[i - 1] + 1e-9), `${pr.id}: fuerte arriba y suave abajo (${dist.map((v) => v.toFixed(2)).join(' → ')})`);
    // El módulo dice cuál es su punto peor; tiene que coincidir con el de esta cuenta (a 0,01).
    const delModulo = Math.min(...deg.peor.map((q) => q.ratio));
    af(Math.abs(delModulo - minDeg) < 0.01, `${pr.id}: el punto peor que calcula el módulo (${delModulo.toFixed(3)}) es el de esta cuenta (${minDeg.toFixed(3)})`);
  }
  console.log('  contraste peor sobre el degradé (mezcla · ratio · dónde): ' + Object.entries(peores).map(([id, v]) => `${id} ${v.mezcla} · ${v.minDeg.toFixed(2)} · ${v.peorDeg}`).join(' | '));
  console.log('  contraste peor de toda la postal: ' + Object.entries(peores).map(([id, v]) => `${id} ${v.min.toFixed(2)}`).join(' · '));
}
if (degradadoPostal) {
  // Un tema hecho a mano con el acento claro y el texto claro: la mezcla BAJA hasta que el texto pase, no se
  // cambia la regla. Y un tema que ni sin degradé pasa no lo arregla la postal (mezcla 0: el fondo liso).
  const p = planPostal(anio(), ctxMentira);
  const claro = { bg: '#101010', accent: '#E0E0E0', text: '#F5F5F5', secondary: '#B0B0B0', elevated: '#202020' };
  const deg = degradadoPostal(p, claro);
  const zona = p.textos.filter((t) => t.sobre === 'degradado');
  const min = Math.min(...zona.map((t) => peorSobreDegrade(deg, t.caja, claro[t.color]).min));
  af(deg.mezcla > 0 && deg.mezcla < P.MEZCLA_MAX && min >= 4.5, `un acento claro con texto claro: la mezcla baja a ${deg.mezcla} y el texto queda en ${min.toFixed(2)}`);
  const malo = degradadoPostal(p, { ...claro, text: '#303030' });
  af(malo.mezcla === 0, `un tema cuyo texto no pasa ni sobre el fondo liso: mezcla 0 (${malo.mezcla})`);
}

// ── 8 · la tapa, de 300 ─────────────────────────────────────────────────────
{
  const p = planPostal(anio(), ctxMentira);
  af(p.tapas.length === 5, 'cinco tapas');
  af(p.tapas.every((t, i) => t.url === IMG(i + 1).replace('ab67616d0000b273', 'ab67616d00001e02')), 'cada tapa pide la variante de 300 (`coverVariant`), sin ida a la API');
  af(p.tapas[0].lado >= 360, `el disco 1 es la imagen de la postal: su tapa mide ${p.tapas[0].lado} ≥ 360`);
  af(p.tapas.slice(1).every((t) => t.lado < p.tapas[0].lado && t.lado <= 300), `los otros cuatro, más chicos y sin pedir más que la de 300 (${p.tapas.slice(1).map((t) => t.lado).join(', ')})`);
  af(p.tapas[0].lado / 300 <= 1.3, `el disco 1 se agranda desde la de 300 como mucho ×1,3 (×${(p.tapas[0].lado / 300).toFixed(2)})`);
}
{
  // Las tapas del JSON del repo (REAL, en solo lectura, sin red): las 45 de los 5 primeros discos de los
  // 9 años. Sin un solo nombre en la salida: solo cuentas.
  const s = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));
  const imgs = s.years.flatMap((y) => (y.top_albums || []).slice(0, 5).map((a) => a.img));
  const FORMA = /\/image\/ab67616d[0-9a-f]{8}[0-9a-f]{24}$/;
  const v300 = imgs.map((u) => (u ? coverVariant(u, 300) : null));
  const cuentas = {
    img: imgs.filter(Boolean).length,
    matchean: imgs.filter((u) => u && FORMA.test(u)).length,
    cambian: imgs.filter((u, i) => u && v300[i] !== u).length,
    prefijo300: v300.filter((u) => u && /\/image\/ab67616d00001e02[0-9a-f]{24}$/.test(u)).length,
    host: imgs.filter((u, i) => u && new URL(v300[i]).host === new URL(u).host).length,
  };
  console.log(`  tapas del JSON del repo (REAL): ${cuentas.img} img · ${cuentas.matchean} con la forma del CDN · ${cuentas.cambian} cambian con coverVariant(300) · ${cuentas.prefijo300} quedan con ab67616d00001e02 · ${cuentas.host} conservan el host`);
  af(s.years.length === 9 && imgs.length === 45 && cuentas.img === 45, `las 45 tapas de los 9 años tienen img (${cuentas.img} de ${imgs.length})`);
  af(cuentas.matchean === 45, `las 45 tienen la forma del CDN, así que coverVariant las sabe cambiar (${cuentas.matchean})`);
  af(cuentas.prefijo300 === 45, `las 45 quedan pidiendo la variante de 300 (${cuentas.prefijo300})`);
  af(cuentas.host === 45, `y conservan su host (${cuentas.host})`);
}

// ── 9 · el aviso del final ──────────────────────────────────────────────────
{
  af(avisoPostal({ faltan: 0 }) === 'Postal descargada.', 'sin faltantes: «Postal descargada.»');
  af(/\b2 tapas no se pudieron bajar\b/.test(avisoPostal({ faltan: 2 })) && avisoPostal({ faltan: 2 }).includes('♪'), `con 2 faltantes lo dice con el número: «${avisoPostal({ faltan: 2 })}»`);
  af(/\b1 tapa no se pudo bajar\b/.test(avisoPostal({ faltan: 1 })), 'con 1, en singular');
  const sin = avisoPostal({ sinTapas: true, motivo: 'SecurityError', faltan: 0 });
  af(sin.startsWith('La postal salió sin tapas: ') && sin.includes('SecurityError'), `sin tapas, lo dice con todas las letras y el motivo: «${sin}»`);
  af(![avisoPostal({}), avisoPostal({ faltan: 3 }), sin].some((x) => /\b(tenés|podés|acá)\b/.test(x)), 'el aviso, en castellano de España');
}

salir();
