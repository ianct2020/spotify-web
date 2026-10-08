// La racha EN CURSO (v=244) — el número del paso nuevo de la apertura.
//
// POR QUÉ ESTA SUITE EXISTE: es el mismo peligro que el calendario de v=216.
// Una racha mal contada no tira ni deja hueco: pinta un número a pantalla
// completa y se queda tan ancha. Y encima es el número con el que Ian va a
// medir la meta de un álbum por día en 2027, así que equivocarse por uno
// cuenta.
//
// Corre contra el JSON REAL del repo y contra la función REAL de
// `features/wrapped-apertura.js` — no una copia. Sin navegador y sin token.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rachaVigente, pasoRacha } from '../src/js/features/wrapped-apertura.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

const DIA = 86400000;
const aMs = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = ms => new Date(ms).toISOString().slice(0, 10);

// ── 1. El contrato que hace posible encadenar años ──────────────────────────
//
// `rachaVigente()` salta de un año al anterior solo si las dos ventanas pegan.
// Si el pipeline dejara de emitirlas contiguas, la función seguiría dando un
// número —el del año suelto— y nadie se enteraría. Esto lo declara.
const anios = [...stats.years]
  .filter(y => y.days && Array.isArray(y.days.min) && y.days.min.length)
  .sort((a, b) => a.year - b.year);

comprobar('todos los años traen `days`', anios.length === stats.years.length,
  `${anios.length} de ${stats.years.length}`);

for (let i = 1; i < anios.length; i++) {
  const fin = aMs(anios[i - 1].days.from) + (anios[i - 1].days.min.length - 1) * DIA;
  comprobar(`la ventana de ${anios[i].year} pega con la de ${anios[i - 1].year}`,
    fin + DIA === aMs(anios[i].days.from),
    `${iso(fin)} → ${anios[i].days.from}`);
}

// ── 2. El método, contra los totales del pipeline ───────────────────────────
//
// Si recorrer la serie concatenada de `days` reproduce `longest_streak` y
// `days_active` de `totals`, entonces contar días seguidos sobre esa serie es
// el mismo criterio que usa `gen-stats.py`. Es la validación cruzada del
// método, por un camino que no pasa por la función que se está probando.
const serie = anios.flatMap(y => y.days.min);
let masLarga = 0, corrida = 0;
for (const v of serie) { if (v > 0) { corrida++; if (corrida > masLarga) masLarga = corrida; } else corrida = 0; }
comprobar('la serie concatenada reproduce totals.longest_streak',
  masLarga === stats.totals.longest_streak, `${masLarga} vs ${stats.totals.longest_streak}`);
comprobar('la serie concatenada reproduce totals.days_active',
  serie.filter(v => v > 0).length === stats.totals.days_active,
  `${serie.filter(v => v > 0).length} vs ${stats.totals.days_active}`);

// ── 3. La función, año por año, contra un recuento independiente ────────────
//
// El recuento de acá va al revés que el de la función: arma la serie entera y
// cuenta hacia atrás desde el corte, sin saber nada de años.
const desdeGlobal = aMs(anios[0].days.from);
function aMano(y) {
  const d = y.days;
  const corte = Math.round((aMs(d.from) - desdeGlobal) / DIA) + d.min.length - 1;
  let n = 0;
  for (let i = corte; i >= 0 && serie[i] > 0; i--) n++;
  return { dias: n, corte: iso(desdeGlobal + corte * DIA) };
}

for (const y of anios) {
  const r = rachaVigente(y, stats);
  const m = aMano(y);
  comprobar(`racha vigente de ${y.year}`, r && r.dias === m.dias, `${r && r.dias} vs ${m.dias}`);
  comprobar(`fecha de corte de ${y.year}`, r && r.corte === m.corte, `${r && r.corte} vs ${m.corte}`);
  comprobar(`la racha de ${y.year} no supera a la más larga del historial`,
    r.dias <= stats.totals.longest_streak, `${r.dias}`);
}

// ── 4. Los números concretos del historial de hoy ───────────────────────────
//
// Anclados a propósito: si el JSON se regenera y estos cambian, el test falla
// y hay que venir a mirar por qué, en vez de enterarse por la pantalla.
const ultimo = anios[anios.length - 1];
const r = rachaVigente(ultimo, stats);
comprobar('el último año del historial es 2026', ultimo.year === 2026, String(ultimo.year));
comprobar('el corte cae el 2026-08-27', r.corte === '2026-08-27', r.corte);
comprobar('la racha en curso es de 4 días', r.dias === 4, String(r.dias));
comprobar('el corte NO es hoy (el export se queda atrás)',
  aMs(r.corte) < Date.now() - DIA, r.corte);

// ── 5. Los bordes que el panel tiene que saber callar ───────────────────────
const cero = { year: 2099, days: { from: '2099-01-01', min: [5, 5, 0] } };
const soloCero = rachaVigente(cero, { years: [cero] });
comprobar('un año que acaba en blanco da 0', soloCero.dias === 0, String(soloCero.dias));

const unDia = { year: 2098, days: { from: '2098-01-01', min: [0, 0, 7] } };
comprobar('un año que acaba con un solo día da 1',
  rachaVigente(unDia, { years: [unDia] }).dias === 1);

const entero = { year: 2097, days: { from: '2097-01-01', min: [3, 3, 3] } };
comprobar('una ventana entera con música se cuenta entera',
  rachaVigente(entero, { years: [entero] }).dias === 3);

// un hueco entre ventanas NO se encadena
const a = { year: 2090, days: { from: '2090-12-30', min: [4, 4] } };   // acaba el 31
const b = { year: 2092, days: { from: '2092-01-01', min: [4, 4] } };   // hueco de un año
comprobar('un hueco entre ventanas corta la racha',
  rachaVigente(b, { years: [a, b] }).dias === 2,
  String(rachaVigente(b, { years: [a, b] }).dias));

// dos ventanas que pegan SÍ se encadenan
const c = { year: 2094, days: { from: '2094-12-30', min: [4, 4] } };
const d = { year: 2095, days: { from: '2095-01-01', min: [4, 4] } };
comprobar('dos ventanas que pegan encadenan la racha',
  rachaVigente(d, { years: [c, d] }).dias === 4,
  String(rachaVigente(d, { years: [c, d] }).dias));

comprobar('un año que no está en stats devuelve null',
  rachaVigente({ year: 1999, days: { from: '1999-01-01', min: [1] } }, { years: [] }) === null);

// ── 6. El aviso del corte NO se puede perder (W.1, v=283) ───────────────────
//
// El párrafo salió de la tarjeta y se metió en un ⓘ. Lo que cambia es DÓNDE se
// pinta; lo que NO puede cambiar es que el texto exista, porque sin él ese
// número se lee como si llegara a hoy y no llega. Un `info` borrado, renombrado
// o vaciado deja la tarjeta idéntica a la vista y el dato falso: no tira ni
// deja hueco. Por eso se declara acá y no se confía en mirarlo.
const fmtDiaTest = (iso) => iso;
const pr = pasoRacha({ y: ultimo, stats, fmtDia: fmtDiaTest });

comprobar('el paso de la racha existe', !!pr);
comprobar('el texto va en `info`, no en `cuerpo`',
  typeof pr.info === 'string' && pr.info.length > 0 && pr.cuerpo === undefined,
  `info=${typeof pr.info} cuerpo=${typeof pr.cuerpo}`);
comprobar('`info` trae el AVISO del corte del historial',
  pr.info.includes('se acaba el historial') && pr.info.includes('volver a importar el historial'),
  pr.info.slice(0, 80));
comprobar('`info` marca el aviso con ⚠️', pr.info.includes('\u26a0\ufe0f'));
comprobar('`info` dice la fecha del corte', pr.info.includes(r.corte), r.corte);
comprobar('la tarjeta conserva número y rótulo',
  Array.isArray(pr.num) && pr.num[0] === r.dias && typeof pr.bajada === 'string' && pr.bajada.length > 0);

// Un año que NO es el último no lleva el aviso (no hay corte que explicar) y
// tampoco tiene que llevar `info`: el ⓘ solo existe donde hay algo que decir.
const anterior = anios[anios.length - 2];
if (anterior) {
  const prAnt = pasoRacha({ y: anterior, stats, fmtDia: fmtDiaTest });
  if (prAnt) {
    comprobar('un año pasado no trae el aviso del corte',
      !prAnt.info || !prAnt.info.includes('se acaba el historial'));
  }
}

console.log(`\nwrapped-racha: ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
