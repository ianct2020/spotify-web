// El fallo de historial se distingue del null válido sin quitar los likes del catálogo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const ID_LIKE = 'a'.repeat(24), ID_HIST = 'b'.repeat(24);
const tapa = id => `https://i.scdn.co/image/ab67616d0000b273${id}`;
const like = { track: { album: { images: [{ width: 64, url: tapa(ID_LIKE) }] } } };
globalThis.__T94A = { modos: [], historialCalls: 0, historial: { years: [{ albums: [{ img: tapa(ID_HIST) }] }] }, likes: [like], reg: null };
globalThis.sessionStorage = { setItem() {} };
const avisos = [];
console.warn = (...xs) => avisos.push(xs.map(x => x instanceof Error ? x.message : String(x)).join(' '));
register('./dobles/loader-catch-94a.mjs', pathToFileURL(import.meta.filename));
const mod = await import('../src/js/features/mosaico-colores.js');

const fuente = readFileSync(new URL('../src/js/app.js', import.meta.url), 'utf8');
const ini = fuente.indexOf('async function montarBaseMosaico()');
const fin = fuente.indexOf('\nasync function renderDebug(', ini);
assert.ok(ini >= 0 && fin > ini, 'se encontró la función real de la vista');
const cuerpo = fuente.slice(ini, fin).replace("await import('./features/mosaico-colores.js')", 'await Promise.resolve(modulo)');
const nodos = new Map();
const elemento = id => {
  if (!nodos.has(id)) nodos.set(id, { innerHTML: '', textContent: '', disabled: false, onclick: null });
  return nodos.get(id);
};
const document = { getElementById: elemento };
const fmtN = n => n.toLocaleString('es-ES');
const fmtMB = b => (b / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const fmtFallidas = n => `${fmtN(n)} fallida${n === 1 ? '' : 's'}`;
const montar = new Function('document', 'modulo', 'fmtN', 'fmtMB', 'fmtFallidas', 'escapeHtml', 'showToast',
  `${cuerpo}\nreturn montarBaseMosaico;`)(document, mod, fmtN, fmtMB, fmtFallidas, x => String(x), () => {});

// Constantes medidas en aa0fc915 antes de cambiar src/.
const CUENTAS_NULL = { total: 1, escuchadas: 0, filasEscuchadas: 0, likes: 1, likesSinTapa: 0, deLikes: 1, soloLikes: 1, enLasDos: 0 };
const CUENTAS_ALBUMS = { total: 2, escuchadas: 1, filasEscuchadas: 1, likes: 1, likesSinTapa: 0, deLikes: 1, soloLikes: 1, enLasDos: 0 };
const TEXTO_NULL = '<strong>0 de 1</strong> portadas con color (0 de álbumes escuchados, 1 más solo de tus likes) · todavía no hay nada guardado';
const TEXTO_ALBUMS = '<strong>0 de 2</strong> portadas con color (1 de álbumes escuchados, 1 más solo de tus likes) · todavía no hay nada guardado';
let n = 0, fallos = 0;
function ok(cond, nombre) { n++; if (!cond) { fallos++; console.log(`  ✗ ${nombre}`); } else console.log(`  ✓ ${nombre}`); }
function eq(actual, esperado, nombre) {
  let igual = true; try { assert.deepEqual(actual, esperado); } catch { igual = false; }
  ok(igual, `${nombre}${igual ? '' : ` — dio ${JSON.stringify(actual)}`}`);
}
async function escenario(modos) {
  nodos.clear(); avisos.length = 0;
  Object.assign(globalThis.__T94A, { modos: [...modos], historialCalls: 0, reg: null });
  const cat = await mod.armarCatalogo();
  await montar();
  return { cat, html: elemento('debug-mosaico-estado').innerHTML };
}

console.log('[a] Fallo INVENTADO: sigue el catálogo de likes y se ve el aviso');
const fallo = await escenario(['throw', 'throw']);
eq(fallo.cat.items.map(x => x.id), [ID_LIKE], 'el catálogo sigue con el like');
eq(fallo.cat.cuentas, { ...CUENTAS_NULL, escuchadasFallo: true }, 'cuentas distingue el fallo');
ok(fallo.html.startsWith(TEXTO_NULL), 'conserva la cuenta de portadas');
ok(fallo.html.includes('<span style="color: var(--color-text-secondary)">No se han podido leer tus álbumes escuchados: el catálogo sale solo con tus me gusta.</span>'), 'pintarGuardado informa el fallo');
ok(avisos.length === 2 && avisos.every(x => x.includes('[mosaico-colores]') && x.includes('doble: historial no disponible')), 'console.warn conserva el error crudo');

console.log('[b] null válido INVENTADO: conservación de aa0fc915');
const vacio = await escenario(['null', 'null']);
eq(vacio.cat.cuentas, CUENTAS_NULL, 'cuentas sin campos nuevos');
eq(vacio.html, TEXTO_NULL, 'texto exacto anterior');
ok(avisos.length === 0, 'sin warning ni aviso falso');

console.log('[c] Álbum escuchado INVENTADO: conservación de aa0fc915');
const sano = await escenario(['albums', 'albums']);
eq(sano.cat.cuentas, CUENTAS_ALBUMS, 'cuentas anteriores');
eq(sano.cat.items.map(x => x.id), [ID_HIST, ID_LIKE], 'catálogo anterior');
eq(sano.html, TEXTO_ALBUMS, 'texto exacto anterior');
ok(avisos.length === 0, 'sin warning');

console.log('[a2] Construir/Continuar INVENTADO: el resumen lleva el fallo hasta la vista');
// Una portada ya guardada evita cualquier descarga; el historial falla solo al construir.
Object.assign(globalThis.__T94A, {
  modos: ['null', 'throw', 'null'], historialCalls: 0,
  reg: { formato: 1, hosts: ['i.scdn.co'], host: new Uint8Array([0]), ids: [ID_LIKE],
    datos: new Uint8Array(27), fallidas: {}, bytes: 0, msRed: 0, creado: 1, actualizado: 1 },
});
avisos.length = 0; nodos.clear();
await montar();
await elemento('debug-mosaico-btn').onclick();
const despues = elemento('debug-mosaico-estado').innerHTML;
ok(despues.includes('No se han podido leer tus álbumes escuchados: el catálogo sale solo con tus me gusta.'), 'el aviso persiste después de construir');
ok(avisos.length === 1 && avisos[0].includes('doble: historial no disponible'), 'la tanda registra el fallo una vez');

console.log(`catch-que-tapan-94a: ${n - fallos}/${n} asserts OK · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
