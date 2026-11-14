// Arnés de la tanda 131 (v=368): el HTML del panel del día de `#calendario`, sacado del `calendario.js`
// REAL, para comparar su `sha256` antes y después de mover las listas a `ui/dia-escuchado.js`.
//
// Lo usa `tests/lluvia-dia-detalle.test.mjs`. 🔴 El que llama tiene que haber registrado
// `dobles/loader-t110.mjs` con estos reales como mínimo: `features/calendario.js`,
// `ui/calendario-anual.js`, `util/fecha.js`, `ui/components.js` y (desde v=368) `ui/dia-escuchado.js`.
// Todo lo demás de `src/js/` lo dobla el loader, y acá se ponen los stubs que hacen falta.
//
// El DOM es de mentira y mínimo: `render()` escribe en `#cal-content`, `conectar()` busca la rejilla y
// sus celdas, y el clic de una celda abre el panel por `openModal()`, que acá GUARDA el HTML y devuelve un
// overlay sin nodos (así las fichas no se conectan: no hace falta, lo que se compara es el HTML).
import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// `escapeHtml()` (`ui/components.js`) escapa con el truco de `textContent` → `innerHTML` de un `<div>`:
// el `<div>` de mentira serializa como el navegador (`&`, `<`, `>` y el espacio duro; las comillas no).
function divFalso() {
  let t = '';
  return {
    set textContent(v) { t = v === null ? '' : String(v); },
    get textContent() { return t; },
    get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); },
  };
}
/** El `document.createElement` mínimo que necesita `escapeHtml()`: solo `<div>`. */
export function crearElementoFalso(tag) {
  if (tag !== 'div') throw new Error('arnés t131: createElement(' + tag + ')');
  return divFalso();
}

const DIA = 86400000;
const aMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/**
 * El HTML del panel de cada día de `dias`, en orden. `stats` es un `history-stats` mínimo (el ÚLTIMO año
 * con `days` es el que abre la vista) y `detalle` el payload `days` (o `null`).
 */
export async function panelesDeCalendario(urlCalendario, { stats, detalle, dias }) {
  const S = (globalThis.__T110 ||= { stubs: {}, valores: {} });
  const modales = [];
  const overlay = { querySelectorAll: () => [], querySelector: () => null };
  Object.assign(S.stubs, {
    'features/history-data.js:loadHistoryStats': async () => stats,
    'features/history-data.js:loadDays': async () => detalle,
    'features/history-data.js:isOwner': async () => true,
    'features/history-data.js:motivoSinImportCompleto': async () => 'owner',
    'util/vigencia-ruta.js:vigilarRuta': () => ({ vigente: () => true }),
    'storage.js:prefKey': (k) => k,
    'ui/modal-stack.js:openModal': ({ html }) => { modales.push(html); return overlay; },
    'ui/reveal.js:animationsEnabled': () => false,
  });

  const anio = stats.years[stats.years.length - 1];
  const D = anio.days;
  const handlers = {};
  const celdas = D.min.map((_, i) => ({
    dataset: { dia: String(i) }, tabIndex: -1,
    classList: { add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, focus() {},
  }));
  const rejilla = { querySelectorAll: () => celdas, addEventListener: (t, f) => { handlers[t] = f; } };
  const content = {
    innerHTML: '', isConnected: true,
    querySelectorAll: () => [],
    querySelector: (s) => (s === '.cal-anual .wr-ap-cal' ? rejilla : null),
  };
  const docAntes = globalThis.document, lsAntes = globalThis.localStorage;
  globalThis.document = {
    getElementById: (id) => (id === 'cal-content' ? content : null),
    createElement: crearElementoFalso,
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    const cal = await import(urlCalendario);
    if (cal.__reiniciarParaTests) cal.__reiniciarParaTests();
    await cal.render({ innerHTML: '' });
    if (!handlers.click) throw new Error('el calendario no conectó el clic de la rejilla');
    const salida = [];
    for (const iso of dias) {
      const i = Math.round((aMs(iso) - aMs(D.from)) / DIA);
      if (i < 0 || i >= celdas.length) throw new Error(`el día ${iso} no está en el tramo de ${anio.year}`);
      const antes = modales.length;
      handlers.click({ target: { closest: () => celdas[i] } });
      if (modales.length !== antes + 1) throw new Error(`el clic en ${iso} no abrió un panel`);
      salida.push(modales[modales.length - 1]);
    }
    return salida;
  } finally {
    globalThis.document = docAntes;
    globalThis.localStorage = lsAntes;
  }
}
