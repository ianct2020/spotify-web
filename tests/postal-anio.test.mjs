// tests/postal-anio.test.mjs — la postal del año «El año en días»: textos, tramas, posiciones y contraste
// (v=326, tanda 73; rediseñada en v=327, tanda 74; reemplazada por el diseño B en v=344, tanda 97)
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PROTEGE ESTE ARCHIVO
// ═══════════════════════════════════════════════════════════════════════════
//
// La postal es una imagen que circula SOLA: no lleva el ⓘ de la vista, ni el aviso del corte de los
// saltos, ni la posibilidad de abrir la ficha y ver de dónde sale un número. Lo que se equivoque ahí no
// lo corrige nadie. Por eso la parte que decide QUÉ dice y DÓNDE va (`src/js/util/postal-anio.js`) es pura
// y se prueba acá, en Node, con años INVENTADOS (2029, 2030, 2031: ningún número es de nadie) y, para el
// tono de cada día, con el `history-stats.json` del repo (solo cuentas, sin un nombre):
//
//   1. las fechas salen con `fmtDia` (el día que dice el dato): con `TZ` de Buenos Aires, el 1 de enero
//      es el 1 de enero, nunca el 31 de diciembre — el bug de v=231. Y el 1/1 cae en la primera casilla
//      de enero, en la columna de su día de la semana (lunes primero);
//   2. los minutos con el `fmtMinutes` QUE SE LE PASA (uno de mentira acá) y los números con
//      `toLocaleString('es-ES')`: la postal no escribe su propio formateador;
//   3. 🔴 ningún texto dice «skip», «salt» ni lleva un porcentaje;
//   4. el recorte con «…», con una medida de mentira: lo que no entra termina en «…» y NUNCA pasa del
//      máximo;
//   5. sin `peak_day`, sin `days` o con `days` vacío, la postal sale igual (y se dice qué sale);
//   6. ninguna caja (texto o día, con el contorno del pico) se sale de 1080×1350 ni se pisa con otra, y
//      cada día cae dentro de su mes;
//   7. el contraste de cada texto contra el punto PEOR detrás de su caja (el fondo y cualquier día que la
//      toque), en los cuatro `PRESETS`, ≥ `PISO_CONTRASTE`; los tonos y la cuenta, rehechos acá por su lado;
//   8. 🔴 el tono de cada día es el del calendario (`calendarioAnual` de `ui/calendario-anual.js`), día por
//      día, para 2025 y 2018 del JSON del repo; un día fuera del tramo va «fuera» y el pico lleva contorno;
//   9. ninguna tapa: ni el módulo puro ni el que dibuja las piden.
//
// Contra v=343 (la postal de las tapas) da rojo: no hay trama de días.

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
const { calendarioAnual, aMs } = await import('../src/js/ui/calendario-anual.js');
let P;
try {
  P = await import('../src/js/util/postal-anio.js');
} catch (e) {
  af(false, `src/js/util/postal-anio.js no carga: ${e.message}`);
  salir();
}
const { planPostal, textosPostal, recortar, ANCHO, ALTO } = P;
// Contra un módulo sin trama, que el test diga qué falta en vez de reventar en el primer `.find`.
const planDe = (y, ctx) => { const p = planPostal(y, ctx); p.celdas ||= []; p.meses ||= []; return p; };
const tonosPostal = typeof P.tonosPostal === 'function' ? P.tonosPostal : null;
const contrastePostal = typeof P.contrastePostal === 'function' ? P.contrastePostal : null;
af(tonosPostal, 'postal-anio.js exporta `tonosPostal` (el tono de cada nivel, de «fuera» y del contorno del pico)');
af(contrastePostal, 'postal-anio.js exporta `contrastePostal` (cada texto contra el punto peor detrás de su caja)');
af(P.PISO_CONTRASTE === 4.6, `el piso de contraste sigue en 4,6 (${P.PISO_CONTRASTE})`);

// ── Los años INVENTADOS ─────────────────────────────────────────────────────
const fmtMentira = (m) => `MIN[${m}]`;
const porLetra = (t) => [...String(t)].length;           // 1 px por carácter
const ancha = (t) => [...String(t)].length * 20;         // 20 px por carácter: para que el recorte muerda
// Medio tamaño de letra por carácter: se parece a la letra de verdad (Inter mide 0,5-0,6 em por carácter).
const proporcional = (t, f) => [...String(t)].length * f.tam * 0.5;
const DIA = 86400000;
const isoDe = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Un tramo `days` inventado: `n` días desde `from`, con minutos pseudoazarosos y algún cero. */
function tramo(from, n, semilla = 7) {
  const min = [];
  let s = semilla;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; min.push(s % 6 === 0 ? 0 : (s % 5000) / 10); }
  return { from, min };
}
function anio(over = {}) {
  return {
    year: 2031, min: 98765, plays: 12345, days_active: 1234, longest_streak: 12345,
    skip_pct: 41.7, skips: 999, plays_raw: 13000,
    first_play: '2031-01-01T00:00:28Z', last_play: '2031-12-31T01:10:00Z',
    peak_day: { date: '2031-03-09', min: 668 },
    days: tramo('2031-01-01', 365),
    top_artists: [{ name: 'Artista inventado', min: 900, plays: 50 }],
    top_albums: [{ name: 'Disco inventado', artist: 'Artista inventado', min: 500, plays: 30, img: 'https://i.scdn.co/image/ab67616d0000b273' + '0'.repeat(24) }],
    ...over,
  };
}
const ctxMentira = { fmtMinutes: fmtMentira, fmtDia, medir: (t) => porLetra(t) };
const textos = (plan) => plan.textos.map((t) => t.texto);
const de = (plan, id) => plan.textos.find((t) => t.id === id);
const celdaDe = (plan, iso) => plan.celdas.find((c) => c.iso === iso);

// ── 1 · las fechas, con fmtDia ──────────────────────────────────────────────
{
  const p = planDe(anio(), ctxMentira);
  af(de(p, 'anio')?.texto === '2031', `el año, grande, tal cual («${de(p, 'anio')?.texto}»)`);
  af(de(p, 'pico')?.texto === '9 mar 2031', `el día pico con fmtDia: «${de(p, 'pico')?.texto}»`);
  af(de(p, 'pico-et')?.texto === 'día pico · MIN[668]', `y sus minutos con el fmtMinutes pasado: «${de(p, 'pico-et')?.texto}»`);
  // El pico el 1 de enero: con `new Date()` en UTC−3 diría «31 dic 2030».
  const enero = planDe(anio({ peak_day: { date: '2031-01-01', min: 5 } }), ctxMentira);
  af(de(enero, 'pico')?.texto === '1 ene 2031', `un pico el 1/1 dice «1 ene 2031», no el día anterior: «${de(enero, 'pico')?.texto}»`);
  af(!textos(enero).some((t) => /31 dic 2030/.test(t)), 'ningún texto corre el día a la hora local');
  // El 1/1/2031 es miércoles: la primera casilla de enero va en la columna 2 (lunes = 0), y es el día 0.
  const c = celdaDe(p, '2031-01-01'), mes = p.meses[0];
  af(c && c.i === 0 && c.mes === 0, `el 1 ene 2031 es la casilla del día 0, en enero (${c && `${c.i}, mes ${c.mes}`})`);
  af(c && mes && c.col === 2 && c.fila === 0 && c.x > mes.x, `y cae en la columna del miércoles, primera fila (col ${c?.col}, fila ${c?.fila})`);
  af(p.celdas.every((x) => x.col === (new Date(aMs(x.iso)).getUTCDay() + 6) % 7), 'cada día va en la columna de su día de la semana (lunes primero)');
  const c31 = celdaDe(p, '2031-12-31');
  af(c31 && c31.i === 364 && c31.mes === 11, `el 31 dic 2031 es el día 364, en diciembre (${c31?.i})`);
}

// ── 2 · los números, y los minutos con el fmtMinutes que se le pasa ─────────
{
  const p = planDe(anio(), ctxMentira);
  af(de(p, 'min')?.texto === 'MIN[98765]', `los minutos del año salen del fmtMinutes pasado: «${de(p, 'min')?.texto}»`);
  af(de(p, 'min-et')?.texto === 'de música', `debajo, «de música»: «${de(p, 'min-et')?.texto}»`);
  af(de(p, 'racha')?.texto === '12.345 días', `la racha con es-ES y «días»: «${de(p, 'racha')?.texto}»`);
  af(de(p, 'racha-et')?.texto === 'racha más larga', `su etiqueta: «${de(p, 'racha-et')?.texto}»`);
  af(de(p, 'pie')?.texto === 'Fonoteca · 2031', `abajo, «Fonoteca · 2031»: «${de(p, 'pie')?.texto}»`);
  af(!textos(p).some((x) => /\d+h \d+m/.test(x)), 'ningún texto trae minutos con otro formateador («Nh Mm»)');
  const uno = planDe(anio({ longest_streak: 1 }), ctxMentira);
  af(de(uno, 'racha')?.texto === '1 día', `en singular con 1: «${de(uno, 'racha')?.texto}»`);
  const corta = planDe(anio({ longest_streak: 1234 }), ctxMentira);
  af(de(corta, 'racha')?.texto === '1234 días', `cuatro cifras sin separador, como es-ES: «${de(corta, 'racha')?.texto}»`);
  // Lo que lleva y nada más: la marca, el año, los minutos, la racha, el pico, los doce meses y el pie.
  const ids = p.textos.map((t) => t.id).sort();
  const esperados = ['marca', 'anio', 'min', 'min-et', 'racha', 'racha-et', 'pico', 'pico-et', 'pie', ...Array.from({ length: 12 }, (_, k) => `mes-${k + 1}`)].sort();
  af(JSON.stringify(ids) === JSON.stringify(esperados), `los textos son esos y nada más (${ids.join(', ')})`);
  af(!textos(p).some((t) => /inventado/i.test(t)), 'ningún nombre de artista ni de disco');
  af(de(p, 'mes-1')?.texto === '01 / ENERO' && de(p, 'mes-12')?.texto === '12 / DICIEMBRE', `los meses: «${de(p, 'mes-1')?.texto}» … «${de(p, 'mes-12')?.texto}»`);
  const tx = textosPostal(anio(), { fmtMinutes: fmtMentira, fmtDia });
  af(tx.anio === '2031' && tx.min === 'MIN[98765]' && tx.pie === 'Fonoteca · 2031', 'textosPostal: lo mismo, sin posiciones');
  af(de(p, 'anio') && de(p, 'anio').fuente.tam > Math.max(...p.textos.filter((t) => t.id !== 'anio').map((t) => t.fuente.tam)), 'el año tiene la letra más grande de la postal');
}

// ── 3 · sin saltos ──────────────────────────────────────────────────────────
for (const y of [anio(), anio({ year: 2022 }), anio({ year: 2018, skip_pct: 64.2 })]) {
  const t = textos(planDe(y, { fmtMinutes: (m) => `${m} min`, fmtDia, medir: porLetra }));
  af(!t.some((x) => /skip|salt|%/i.test(x)), `${y.year}: ningún texto dice «skip», «salt» ni lleva «%» (${t.filter((x) => /skip|salt|%/i.test(x)).join(' | ')})`);
}

// ── 4 · el recorte, con 1 px por carácter ───────────────────────────────────
{
  af(recortar('abcde', 5, porLetra) === 'abcde', 'un texto que entra justo no se toca');
  af(recortar('abcd', 5, porLetra) === 'abcd', 'uno que sobra tampoco');
  const r = recortar('abcdef', 5, porLetra);
  af(r.endsWith('…') && porLetra(r) <= 5 && r === 'abcd…', `uno que no entra termina en «…» y no pasa del máximo: «${r}»`);
  af(recortar('', 5, porLetra) === '', 'un texto vacío no rompe');
  af(recortar(null, 5, porLetra) === '' && recortar(undefined, 5, porLetra) === '', 'ni uno nulo');
  af(recortar('abc', 0, porLetra) === '', 'con máximo 0 no sale nada (ni el «…», que no entra)');
  af(recortar('abc', 1, porLetra) === '…', 'con máximo 1, solo el «…»');
  af(recortar('ab   cdef', 6, porLetra) === 'ab…', `no deja un espacio colgando antes del «…»: «${recortar('ab   cdef', 6, porLetra)}»`);
  af(recortar('🎵🎵🎵🎵', 3, porLetra) === '🎵🎵…', 'no parte un carácter de dos unidades por la mitad');
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
  // En la postal, con 20 px por carácter: los minutos de mentira no entran y se cortan; nada pasa de su caja.
  // Unos minutos de mentira de 40 caracteres (800 px) en una caja de 430: tienen que cortarse.
  const p = planDe(anio(), { fmtMinutes: (m) => `MIN[${m}]`.padEnd(40, '9'), fmtDia, medir: ancha });
  const pasados = p.textos.filter((t) => ancha(t.texto) > t.max);
  af(pasados.length === 0, `ningún texto pasa de su máximo con 20 px por carácter: ${pasados.map((t) => t.id).join(', ')}`);
  af(de(p, 'min')?.texto.endsWith('…'), `y el que no entra lleva el «…» («${de(p, 'min')?.texto}»)`);
}

// ── 5 · lo que falta no la rompe ────────────────────────────────────────────
{
  const sinPico = planDe(anio({ peak_day: null }), ctxMentira);
  af(de(sinPico, 'pico')?.texto === '—' && de(sinPico, 'pico-et')?.texto === 'día pico' && !sinPico.celdas.some((c) => c.pico), 'sin día pico: «—», «día pico» y ningún contorno');
  for (const [que, days] of [['sin days', undefined], ['con days vacío', { from: '2031-01-01', min: [] }], ['con days null', null]]) {
    let p = null, err = null;
    try { p = planDe(anio({ days }), ctxMentira); } catch (e) { err = e; }
    af(p && !err, `${que}: la postal sale (${err?.message || 'ok'})`);
    if (!p) continue;
    af(p.celdas.length === 365 && p.celdas.every((c) => c.fuera && c.i === -1 && !c.pico), `${que}: los 365 días del año van «fuera», sin pico (${p.celdas.filter((c) => c.fuera).length} de ${p.celdas.length})`);
    af(de(p, 'anio')?.texto === '2031' && de(p, 'min')?.texto === 'MIN[98765]' && de(p, 'pico')?.texto === '9 mar 2031', `${que}: el año, los minutos y el pico, igual`);
  }
}

// ── 6 · las posiciones ──────────────────────────────────────────────────────
const pisa = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
// El contorno del pico va centrado en el borde de la casilla, de 2 px: 1 px por fuera. Se cuenta en todas.
const cajaCelda = (c) => ({ id: `dia-${c.iso}`, x: c.x - 1, y: c.y - 1, w: c.w + 2, h: c.h + 2 });
for (const [que, y, medir] of [
  ['2031 entero', anio(), porLetra],
  ['con 20 px por carácter', anio(), ancha],
  ['con medio tamaño por carácter', anio(), proporcional],
  ['un bisiesto (2028)', anio({ year: 2028, days: tramo('2028-01-01', 366), peak_day: { date: '2028-02-29', min: 9 } }), proporcional],
  ['un tramo que arranca a mitad (2029)', anio({ year: 2029, days: tramo('2029-08-15', 139), peak_day: { date: '2029-10-13', min: 9 } }), proporcional],
]) {
  const p = planDe(y, { fmtMinutes: fmtMentira, fmtDia, medir });
  af(p.ancho === 1080 && p.alto === 1350 && ANCHO === 1080 && ALTO === 1350, `${que}: el lienzo es de 1080×1350`);
  const largo = (Date.UTC(y.year + 1, 0, 1) - Date.UTC(y.year, 0, 1)) / DIA;
  af(p.celdas.length === largo && new Set(p.celdas.map((c) => c.iso)).size === largo, `${que}: una casilla por día del año (${p.celdas.length} de ${largo})`);
  const todas = [...p.textos.map((t) => ({ id: t.id, ...t.caja })), ...p.celdas.map(cajaCelda)];
  const fuera = todas.filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > 1080 || c.y + c.h > 1350 || !(c.w > 0 && c.h > 0));
  af(fuera.length === 0, `${que}: ninguna caja se sale de 1080×1350 (${fuera.slice(0, 5).map((c) => c.id).join(', ')})`);
  const pisadas = [];
  for (let i = 0; i < todas.length; i++) for (let j = i + 1; j < todas.length; j++) if (pisa(todas[i], todas[j])) pisadas.push(`${todas[i].id}×${todas[j].id}`);
  af(pisadas.length === 0, `${que}: ningún texto ni día se pisa con otro (${pisadas.slice(0, 5).join(', ')})`);
  af(p.meses.length === 12, `${que}: doce meses`);
  const malMes = p.celdas.filter((c) => { const m = p.meses[c.mes]; return !m || +c.iso.slice(5, 7) !== c.mes + 1 || c.x < m.x || c.y < m.y || c.x + c.w > m.x + m.w || c.y + c.h > m.y + m.h; });
  af(malMes.length === 0, `${que}: cada día cae dentro del recuadro de su mes (${malMes.slice(0, 3).map((c) => c.iso).join(', ')})`);
  const pasados = p.textos.filter((t) => medir(t.texto, t.fuente) > t.max);
  af(pasados.length === 0, `${que}: ningún texto pasa de su máximo (${pasados.map((t) => t.id).join(', ')})`);
}

// ── 7 · el contraste, en los cuatro presets ─────────────────────────────────
// La cuenta de WCAG 2.x, la MISMA de `tests/tema-contraste.test.mjs`. Los tonos de los días y la cuenta
// del punto peor los rehace ESTE test: si el módulo se equivocara, esto no lo copia.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, p) => hex(rgb(a).map((v, i) => v * (1 - p) + rgb(b)[i] * p));
const coloresDe = (pr) => ({ bg: pr.colors['--color-bg'], surface: pr.colors['--color-surface'], accent: pr.colors['--color-accent'], text: pr.colors['--color-text'], secondary: pr.colors['--color-text-secondary'] });
const peores = {};
if (tonosPostal && contrastePostal) {
  const p = planDe(anio(), { fmtMinutes: fmtMentira, fmtDia, medir: proporcional });
  af(p.textos.every((t) => t.color === 'text' || t.color === 'secondary'), `solo --color-text y --color-text-secondary para el texto (${[...new Set(p.textos.map((t) => t.color))].join(', ')})`);
  af(PRESETS.length === 4, `cuatro presets (${PRESETS.length})`);
  for (const pr of PRESETS) {
    const col = coloresDe(pr);
    const t = tonosPostal(col);
    // Los tonos del diseño B (tanda 91B): el nivel 0 es la superficie hacia el fondo; del 1 al 3, el fondo
    // hacia el acento; «fuera», el fondo hacia la superficie; el contorno del pico, el texto.
    const mios = { niveles: [mix(col.surface, col.bg, 0.3), mix(col.bg, col.accent, 0.27), mix(col.bg, col.accent, 0.54), mix(col.bg, col.accent, 0.84)], fuera: mix(col.bg, col.surface, 0.48), borde: col.text };
    af(JSON.stringify(t.niveles.map((x) => x.toLowerCase())) === JSON.stringify(mios.niveles) && t.fuera.toLowerCase() === mios.fuera && t.borde.toLowerCase() === col.text.toLowerCase(), `${pr.id}: los tonos son los del diseño B, del tema y sin nada escrito a mano (${t.niveles.join(' ')} · fuera ${t.fuera})`);
    const dist = t.niveles.slice(1).map((c) => contraste(c, col.bg));
    af(dist.every((v, i) => i === 0 || v > dist[i - 1]), `${pr.id}: del nivel 1 al 3, cada vez más lejos del fondo (${dist.map((v) => v.toFixed(2)).join(' → ')})`);
    af(new Set([t.fuera, t.niveles[0], col.bg].map((x) => x.toLowerCase())).size === 3, `${pr.id}: «fuera», el día sin música y el fondo son tres colores distintos`);
    // El punto peor detrás de cada caja: el fondo y el tono (y el contorno, si es el pico) de cada día que la toque.
    const bajos = [];
    let min = Infinity, donde = '';
    for (const x of p.textos) {
      const detras = [col.bg];
      for (const c of p.celdas) if (pisa(x.caja, cajaCelda(c))) detras.push(c.fuera ? mios.fuera : mios.niveles[c.nivel], ...(c.pico ? [col.text] : []));
      const r = Math.min(...detras.map((d) => contraste(col[x.color], d)));
      if (r < min) { min = r; donde = x.id; }
      if (!(r >= P.PISO_CONTRASTE)) bajos.push(`${x.id} ${r.toFixed(2)}`);
    }
    af(bajos.length === 0, `${pr.id}: cada texto ≥ ${P.PISO_CONTRASTE}:1 contra el punto peor detrás de su caja (mínimo ${min.toFixed(2)}, ${donde}): ${bajos.join(', ')}`);
    const delModulo = contrastePostal(p, col);
    const minMod = Math.min(...delModulo.map((q) => q.ratio));
    af(delModulo.length === p.textos.length && Math.abs(minMod - min) < 0.01, `${pr.id}: el punto peor del módulo (${minMod.toFixed(3)}) es el de esta cuenta (${min.toFixed(3)})`);
    peores[pr.id] = { min, donde };
  }
  console.log('  contraste peor de la postal (del test): ' + Object.entries(peores).map(([id, v]) => `${id} ${v.min.toFixed(2)} (${v.donde})`).join(' · '));
  // Un texto encima de un día: el módulo lo mide contra ese día, no contra el fondo.
  const col = coloresDe(PRESETS[0]);
  const c = p.celdas.find((x) => !x.fuera && x.nivel === 3);
  const encima = { ...p, textos: [{ id: 'encima', texto: 'x', color: 'text', caja: { x: c.x + 2, y: c.y + 2, w: 4, h: 4 } }] };
  const r = contrastePostal(encima, col)[0];
  af(r && Math.abs(r.ratio - contraste(col.text, tonosPostal(col).niveles[3])) < 0.01, `un texto sobre un día del nivel 3 se mide contra ese día (${r?.ratio.toFixed(2)})`);
}

// ── 8 · el tono de cada día es el del calendario (el JSON del repo) ─────────
{
  const s = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));
  const ctxCal = { fmtDia, fmtMinutes: (m) => `${m}`, MESES_LARGOS: Array.from({ length: 12 }, (_, k) => `m${k}`) };
  for (const year of [2025, 2018]) {
    const y = s.years.find((x) => x.year === year);
    const D = y?.days;
    af(D?.from && D.min?.length, `${year}: el JSON del repo trae days`);
    if (!D?.min?.length) continue;
    const iPico = y.peak_day?.date ? Math.round((aMs(y.peak_day.date) - aMs(D.from)) / DIA) : -1;
    // Las casillas del calendario, en orden (los huecos no llevan `title`): su nivel y si es el pico.
    const cal = [...calendarioAnual(D, iPico, ctxCal).matchAll(/<i class="([^"]*)" title=/g)].map((m) => ({ nivel: +(m[1].match(/\bn(\d)\b/)?.[1] || 0), pico: /\bpico\b/.test(m[1]) }));
    const p = planDe(y, { fmtMinutes: fmtMentira, fmtDia, medir: proporcional });
    const conDato = p.celdas.filter((c) => !c.fuera).sort((a, b) => a.i - b.i);
    const iguales = conDato.filter((c) => cal[c.i] && cal[c.i].nivel === c.nivel).length;
    const porNivel = [0, 1, 2, 3].map((n) => conDato.filter((c) => c.nivel === n).length);
    const fueraEsperados = p.celdas.length - D.min.length;
    console.log(`  ${year} (REAL, solo cuentas): ${D.min.length} días con dato · ${iguales} con el nivel del calendario · por nivel ${porNivel.join('/')} · ${p.celdas.filter((c) => c.fuera).length} fuera`);
    af(cal.length === D.min.length && conDato.length === D.min.length, `${year}: tantas casillas con dato como días del tramo (${conDato.length}, calendario ${cal.length}, tramo ${D.min.length})`);
    af(iguales === D.min.length, `${year}: el nivel de cada día es el del calendario (${iguales} de ${D.min.length})`);
    af(conDato.every((c) => c.iso === isoDe(aMs(D.from) + c.i * DIA)), `${year}: cada casilla lleva el día que le toca`);
    af(p.celdas.filter((c) => c.fuera).length === fueraEsperados, `${year}: los días del año fuera del tramo van «fuera» (${fueraEsperados})`);
    const picoPostal = p.celdas.filter((c) => c.pico), picoCal = cal.findIndex((c) => c.pico);
    af(picoPostal.length === 1 && picoPostal[0].i === picoCal && picoPostal[0].iso === y.peak_day.date.slice(0, 10), `${year}: el pico lleva contorno, en el mismo día que el calendario (${picoPostal.length} contorno, día ${picoPostal[0]?.i} contra ${picoCal})`);
  }
  // 2018 arranca el 15/08: del 1/1 al 14/08 van «fuera» (lo que no registró el export no es «sin música»).
  const y18 = s.years.find((x) => x.year === 2018);
  if (y18?.days) {
    const p = planDe(y18, { fmtMinutes: fmtMentira, fmtDia, medir: proporcional });
    af(celdaDe(p, '2018-08-14')?.fuera && !celdaDe(p, '2018-08-15')?.fuera, '2018: el 14/08 va «fuera» y el 15/08, con su nivel');
  }
}
{
  // Un tramo inventado que arranca el 10/03 y termina el 20/11: los de afuera, «fuera»; un cero, nivel 0.
  const D = tramo('2031-03-10', 256);
  D.min[3] = 0;
  const p = planDe(anio({ days: D, peak_day: { date: '2031-05-01', min: 9 } }), ctxMentira);
  af(celdaDe(p, '2031-03-09')?.fuera && celdaDe(p, '2031-01-01')?.fuera, 'el día anterior al tramo va «fuera»');
  af(celdaDe(p, '2031-11-20')?.fuera === false && celdaDe(p, '2031-11-21')?.fuera, `el último día del tramo tiene nivel y el siguiente va «fuera» (${celdaDe(p, '2031-11-20')?.i})`);
  af(celdaDe(p, '2031-03-13')?.nivel === 0 && !celdaDe(p, '2031-03-13')?.fuera, 'un día del tramo sin minutos va con el nivel 0, no «fuera»');
  af(p.celdas.filter((c) => c.pico).length === 1 && celdaDe(p, '2031-05-01')?.pico, 'el pico lleva contorno');
  // Un pico que cae fuera del tramo no lleva contorno (no hay casilla con dato que marcar).
  const raro = planDe(anio({ days: D, peak_day: { date: '2031-01-05', min: 9 } }), ctxMentira);
  af(!raro.celdas.some((c) => c.pico), 'un pico fuera del tramo no marca ninguna casilla');
}

// ── 9 · ninguna tapa ────────────────────────────────────────────────────────
{
  const p = planDe(anio(), ctxMentira);
  af(!('tapas' in p) && !JSON.stringify(p).includes('scdn'), 'el plan no trae tapas ni ninguna URL del CDN');
  const puro = readFileSync(join(raiz, 'src/js/util/postal-anio.js'), 'utf8');
  const dibujo = readFileSync(join(raiz, 'src/js/features/wrapped-postal.js'), 'utf8');
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  af(!/coverVariant|album-key/.test(sinComentarios(puro)), 'postal-anio.js no importa coverVariant');
  af(!/conTapa|TOPE_TAPA_MS|createImageBitmap|fetch\(/.test(sinComentarios(dibujo)), 'wrapped-postal.js no baja ninguna tapa (ni conTapa, ni TOPE_TAPA_MS, ni fetch)');
  af(/tercilesDelTramo/.test(sinComentarios(puro)) && /from '\.\.\/ui\/calendario-anual\.js'/.test(puro), 'postal-anio.js IMPORTA tercilesDelTramo de ui/calendario-anual.js (una sola regla de niveles)');
}

salir();
