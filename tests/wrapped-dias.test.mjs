// Contrato de `years[].days` (v=216) — el detalle por día que dibuja el
// calendario de la apertura del Wrapped.
//
// POR QUÉ ESTA SUITE EXISTE: el calendario es el único paso del recorrido que
// puede MENTIR sin fallar. Si `days.min` se desalinea de `days_active` o de la
// ventana que cuenta `daysCovered()`, el dibujo sigue pintándose precioso y
// dice otra cosa que la baldosa que tiene tres centímetros más abajo. No hay
// excepción que salte: hay dos números distintos en la misma pantalla.
//
// Corre contra el JSON REAL del repo, sin navegador y sin token.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

// ── réplica de daysCovered() de src/js/features/wrapped.js ──────────────────
// A propósito escrita a mano y no importada: si alguien cambia el criterio allá
// sin querer, esto tiene que fallar. Es el punto de tener dos versiones.
const bisiesto = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const aMs = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

function daysCovered(year) {
  const total = bisiesto(year) ? 366 : 365;
  const years = stats.years;
  const primera = (years[0].first_play || '').slice(0, 10);
  const ultima = (years[years.length - 1].last_play || '').slice(0, 10);
  if (+primera.slice(0, 4) > year || +ultima.slice(0, 4) < year) return total;
  const desde = +primera.slice(0, 4) === year ? aMs(primera) : Date.UTC(year, 0, 1);
  const hasta = +ultima.slice(0, 4) === year ? aMs(ultima) : Date.UTC(year, 11, 31);
  return Math.max(1, Math.min(total, Math.round((hasta - desde) / 86400000) + 1));
}

comprobar('hay años en el JSON', stats.years?.length > 0);

for (const y of stats.years) {
  const et = `${y.year}`;
  const D = y.days;
  comprobar(`${et}: emite days`, !!D && Array.isArray(D.min) && D.min.length > 0);
  if (!D || !Array.isArray(D.min) || !D.min.length) continue;

  // 1. la ventana es la MISMA que la del denominador que ya muestra la baldosa
  comprobar(`${et}: len(days.min) == daysCovered()`,
    D.min.length === daysCovered(y.year), `${D.min.length} vs ${daysCovered(y.year)}`);

  // 2. `from` cae dentro del año y es el primer día de la ventana
  comprobar(`${et}: days.from es de ese año`, D.from.slice(0, 4) === String(y.year), D.from);

  // 3. los días con algo son EXACTAMENTE days_active — el número de la baldosa
  const activos = D.min.filter(v => v > 0).length;
  comprobar(`${et}: no-cero == days_active`,
    activos === y.days_active, `${activos} vs ${y.days_active}`);

  // 4. la suma cuadra con los minutos del año. La tolerancia es el redondeo a
  //    un decimal de cada día: como mucho 0,05 por día.
  const suma = D.min.reduce((a, v) => a + v, 0);
  comprobar(`${et}: suma ≈ year.min`,
    Math.abs(suma - y.min) <= D.min.length * 0.05 + 0.1, `${suma.toFixed(1)} vs ${y.min}`);

  // 5. el máximo del array TIENE que ser el peak_day, en fecha y en minutos.
  //    Es lo que hace que el cuadradito marcado del calendario y la baldosa
  //    «Día más largo» señalen el mismo día.
  if (y.peak_day) {
    const i = D.min.reduce((mejor, v, k) => (v > D.min[mejor] ? k : mejor), 0);
    const fecha = new Date(aMs(D.from) + i * 86400000).toISOString().slice(0, 10);
    comprobar(`${et}: el máximo es peak_day`, fecha === y.peak_day.date, `${fecha} vs ${y.peak_day.date}`);
    comprobar(`${et}: minutos del máximo == peak_day.min`,
      D.min[i] === y.peak_day.min, `${D.min[i]} vs ${y.peak_day.min}`);
  }

  // 6. la racha más larga recalculada del array == longest_streak
  let mejor = 0, act = 0;
  for (const v of D.min) { act = v > 0 ? act + 1 : 0; if (act > mejor) mejor = act; }
  comprobar(`${et}: racha recalculada == longest_streak`,
    mejor === y.longest_streak, `${mejor} vs ${y.longest_streak}`);

  // 7. nada negativo y nada absurdo (más minutos que un día)
  comprobar(`${et}: ningún valor negativo`, D.min.every(v => v >= 0));
  comprobar(`${et}: ningún día pasa de 1440 min`, D.min.every(v => v <= 1440),
    `máx ${Math.max(...D.min)}`);
}

// 8. el puerto BYOH tiene que emitir lo mismo. No se puede correr acá (necesita
//    el ZIP), pero sí se puede comprobar que el campo EXISTE en el código: sin
//    esto, quien sube su propio historial se queda sin calendario y el owner no.
const proc = readFileSync(join(raiz, 'src/js/history-processor.js'), 'utf8');
comprobar('history-processor.js emite `days`', /^\s*days: daysOut,$/m.test(proc));
comprobar('history-processor.js tiene ventanaDelAnio', /function ventanaDelAnio/.test(proc));

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
