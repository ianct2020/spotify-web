// La tarjeta `meses` de la apertura del Wrapped — el aviso del corte, en el ⓘ.
//
// POR QUÉ ESTA SUITE EXISTE: es la gemela exacta de `wrapped-racha.test.mjs`, y
// por el mismo peligro. La última barra del gráfico mes a mes NO es un mes
// flojo: está CORTADA donde termina el export. El aviso que lo dice vivía
// sepultado al final de un párrafo de 207 caracteres y desde v=285 vive en su
// propio campo, `info`, que `montarApertura()` pinta como el ⓘ que estrenó
// v=283 para la racha.
//
// Borrar `info`, renombrarlo, vaciarlo o volver a meter el aviso dentro de
// `cuerpo` deja la tarjeta IDÉNTICA a la vista y el dato falso: no tira, no
// deja hueco, miente. Eso no lo caza mirar una captura. Se declara acá.
//
// Corre contra el JSON REAL del repo y contra la función REAL de
// `features/wrapped-apertura.js` — no una copia. Sin navegador y sin token.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pasoMeses } from '../src/js/features/wrapped-apertura.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

// El ctx mínimo que `pasoMeses` consume, con los mismos nombres que le pasa
// `render()` de `wrapped.js` (ver la llamada a `montarApertura`).
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmtMinutes = (m) => `${Math.round(m)} min`;
const fmtDia = (iso) => iso;
const ultimoDia = (stats.years[stats.years.length - 1]?.last_play || '').slice(0, 10) || null;
const ctxDe = (y) => ({ y, stats, fmtMinutes, fmtDia, MESES_LARGOS, ultimoDia });

const anios = [...stats.years].sort((a, b) => a.year - b.year);
const ultimo = anios[anios.length - 1];

comprobar('el JSON trae `monthly`', Array.isArray(stats.monthly) && stats.monthly.length > 0,
  `${(stats.monthly || []).length} meses`);
comprobar('hay un `last_play` del que sacar el corte', !!ultimoDia, String(ultimoDia));

// ── El año en curso: el que lleva el aviso ──────────────────────────────────
const pm = pasoMeses(ctxDe(ultimo));

comprobar('el paso de los meses existe', !!pm);
comprobar('el AVISO del corte va en `info`, o sea en el ⓘ',
  typeof pm.info === 'string' && pm.info.length > 0,
  `info=${typeof pm.info}`);
comprobar('`info` dice que la última barra está cortada',
  pm.info.includes('última barra') && pm.info.includes('cortada'),
  pm.info.slice(0, 90));
comprobar('`info` dice la FECHA del corte', pm.info.includes(ultimoDia), ultimoDia);
comprobar('`info` dice que ese mes no está completo', pm.info.includes('no está completo'));
comprobar('`info` marca el aviso con ⚠️, igual que `racha`', pm.info.includes('⚠️'));

// ── Y lo que NO puede volver a pasar: el aviso diluido en el párrafo ────────
comprobar('el aviso YA NO está en `cuerpo`',
  typeof pm.cuerpo === 'string' && !pm.cuerpo.includes('última barra') && !pm.cuerpo.includes('cortada'),
  pm.cuerpo.slice(0, 90));
comprobar('`cuerpo` conserva los datos que describe (el pico)',
  pm.cuerpo.includes('más alto'), pm.cuerpo.slice(0, 60));
comprobar('`cuerpo` bajó de los 207 caracteres que tenía con el aviso dentro',
  pm.cuerpo.length < 207, `${pm.cuerpo.length} car.`);

// ── La tarjeta no pierde nada de lo que ya mostraba ────────────────────────
comprobar('sigue el titular del pico', typeof pm.titular === 'string' && pm.titular.includes('pico'));
comprobar('sigue la bajada con los minutos', typeof pm.bajada === 'string' && pm.bajada.length > 0);
comprobar('sigue el GRÁFICO mes a mes', typeof pm.visual === 'string' && pm.visual.length > 0);
comprobar('sigue siendo la tarjeta chica', pm.chico === true);

// ── Un año pasado no tiene corte que avisar: no lleva ⓘ ───────────────────
//
// `montarApertura()` pinta el ⓘ solo si `p.info` es truthy, así que con `info`
// sin definir la tarjeta sale como siempre. Es lo correcto: un ⓘ que al abrirse
// no dice nada es peor que no tenerlo.
const anterior = anios[anios.length - 2];
if (anterior) {
  const pmAnt = pasoMeses(ctxDe(anterior));
  if (pmAnt) {
    comprobar('un año pasado NO trae `info` (no hay corte que explicar)', !pmAnt.info,
      String(pmAnt.info).slice(0, 60));
    comprobar('un año pasado sí trae su `cuerpo`',
      typeof pmAnt.cuerpo === 'string' && pmAnt.cuerpo.length > 0);
  }
}

console.log(`\nwrapped-meses: ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
