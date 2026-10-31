// tests/debug-ocultos-390.test.mjs — tanda 108 (v=351): «Salud de los ocultos» y `#debug-log`.
//
// T108b. Hasta v=350 la tabla tenía siete columnas y la clave de cada huérfana iba en la
// última («cuáles»): a 390 px quedaba fuera de la tarjeta (había que deslizar la tabla) y a
// 1366 debajo de los toasts. Ahora son cinco (ícono, vista, aquí, playlist, huérfanas) y lo
// suelto va en una fila propia debajo, `<td colspan="5">`, con cada clave en un
// `.debug-oc-clave`. Y «1 ocultos» pasa a «1 oculto».
//
// `tablaDeOcultos()` (y, si existe, `ocultosSueltos()`) se saca del fuente de `app.js` con un
// `escapeHtml` y un `leerIncidencias` de mentira. Filas INVENTADAS (claves `t108inventada…`).
//
// T108c. `#debug-log` nace escondido (`hidden`) y «Correr tests» lo muestra: lectura del fuente
// (apretarlo pide a la API).
//
// `T108_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 87a6d2b).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ_SRC = process.env.T108_SRC ? resolve(process.env.T108_SRC) : resolve(import.meta.dirname, '../src');
const fuente = readFileSync(resolve(RAIZ_SRC, 'js/app.js'), 'utf8');
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }

const ini = fuente.indexOf('// ── Salud de los ocultos (v=205)');
const fin = fuente.indexOf('// ── Base de colores del mosaico (v=248)', ini);
if (ini < 0 || fin < 0) { console.log('✗ no se encontró el bloque de «Salud de los ocultos» en app.js'); process.exit(1); }
const escapeHtml = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const { tablaDeOcultos, ocultosSueltos } = new Function('escapeHtml', 'leerIncidencias',
  `${fuente.slice(ini, fin)}\nreturn { tablaDeOcultos, ocultosSueltos: typeof ocultosSueltos === 'function' ? ocultosSueltos : null };`)(escapeHtml, () => []);

const K1 = 't108inventada000000001', K2 = 't108inventada000000002';
const fila = (o) => ({ label: 'vista inventada', local: 3, enPlaylist: 3, huerfanas: [], sinUri: [], detalleSinUri: [], error: null, ...o });
const sana = fila({ label: 'skips inventada' });
const conHuerfana = fila({ label: 'sin plays inventada', local: 3, enPlaylist: 2, huerfanas: [K1], sinUri: [K1], detalleSinUri: [{ key: K1, definitivo: false, motivo: 'motivo inventado' }] });
const conDos = fila({ label: 'otra inventada', local: 4, enPlaylist: 2, huerfanas: [K1, K2], detalleSinUri: [{ key: K2, definitivo: true, motivo: 'otro motivo inventado' }] });
const conError = fila({ label: 'rota inventada', error: 'error inventado' });

// Las filas `<tr>` del cuerpo, con lo que tienen adentro.
const filasTr = (html) => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[0]);

console.log('\n[1] encabezado: cinco columnas, sin «cuáles» ni «sin uri»');
{
  const html = tablaDeOcultos([sana, conHuerfana]);
  const ths = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].trim());
  ok(!ths.includes('cuáles'), `no hay <th> «cuáles» (hay ${JSON.stringify(ths)})`);
  ok(!ths.includes('sin uri'), 'no hay <th> «sin uri»');
  ok(ths.length === 5, `cinco <th> (hay ${ths.length})`);
}

console.log('\n[2] una fila con una huérfana lleva su fila de detalle a todo lo ancho');
{
  const trs = filasTr(tablaDeOcultos([conHuerfana]));
  const i = trs.findIndex(t => t.includes('sin plays inventada'));
  const det = trs[i + 1] || '';
  ok(i >= 0 && /<td\b[^>]*colspan="5"/.test(det), 'la fila siguiente tiene un <td colspan="5">');
  ok(new RegExp(`<span class="debug-oc-clave"[^>]*>${K1}</span>`).test(det), 'la clave va dentro de un .debug-oc-clave');
  ok(/se reintenta cada 24 h/.test(det) && /motivo inventado/.test(det), 'con su sello y su motivo');
  ok(/sin forma de subirla a Spotify: 1/.test(det), 'primero «sin forma de subirla a Spotify: 1»');
  ok(det.indexOf('sin forma de subirla') < det.indexOf(K1), 'antes que la clave');
  ok(!(trs[i] || '').includes(K1), 'la clave ya no va en la fila de números');
}

console.log('\n[3] dos huérfanas, una definitiva; y una fila con error');
{
  const trs = filasTr(tablaDeOcultos([conDos, conError]));
  const det = trs[trs.findIndex(t => t.includes('otra inventada')) + 1] || '';
  ok((det.match(/class="debug-oc-clave"/g) || []).length === 2, 'dos .debug-oc-clave en el detalle');
  ok(/definitivo, ya no se busca/.test(det), 'el sello definitivo');
  ok(!/sin forma de subirla/.test(det), 'sin uri = 0: no lo dice');
  const detErr = trs[trs.findIndex(t => t.includes('rota inventada')) + 1] || '';
  ok(/colspan="5"/.test(detErr) && /error inventado/.test(detErr), 'la fila con error lleva el error en su detalle');
}

console.log('\n[4] una fila ✅ no lleva detalle');
{
  const trs = filasTr(tablaDeOcultos([sana]));
  ok(!trs.some(t => /colspan/.test(t)), 'ninguna fila con colspan');
  ok(trs.filter(t => !/<th\b/.test(t)).length === 1, 'una sola fila de cuerpo');
}

console.log('\n[5] los plurales del encabezado y del toast');
{
  ok(/1 oculto solo en este navegador/.test(tablaDeOcultos([conHuerfana])), 'encabezado con 1: «1 oculto solo en este navegador»');
  ok(!/1 ocultos/.test(tablaDeOcultos([conHuerfana])), 'y no «1 ocultos»');
  ok(/2 ocultos solo en este navegador/.test(tablaDeOcultos([conDos])), 'encabezado con 2: «2 ocultos solo en este navegador»');
  ok(/Ningún oculto suelto/.test(tablaDeOcultos([sana])), 'con 0: «Ningún oculto suelto»');
  ok(ocultosSueltos && ocultosSueltos(1, true) === '1 oculto está solo en este navegador', `toast con 1: ${JSON.stringify(ocultosSueltos?.(1, true))}`);
  ok(ocultosSueltos && ocultosSueltos(2, true) === '2 ocultos están solo en este navegador', `toast con 2: ${JSON.stringify(ocultosSueltos?.(2, true))}`);
  ok(/showToast\(sueltas\s*\?\s*ocultosSueltos\(sueltas, true\)/.test(fuente), 'el toast de «Salud de los ocultos» usa ocultosSueltos(sueltas, true)');
}

console.log('\n[6] T108c: #debug-log nace escondido y «Correr tests» lo muestra');
{
  const pre = (fuente.match(/<pre id="debug-log"[^>]*>/) || [''])[0];
  ok(/\shidden[\s>]/.test(pre), `el <pre id="debug-log"> lleva hidden (${pre.slice(0, 40)}…)`);
  ok(!/display\s*:/.test(pre), 'su estilo en línea no fija display (hidden lo esconde)');
  const clic = fuente.slice(fuente.indexOf("document.getElementById('debug-run-btn').onclick"));
  const primeras = clic.split('\n').slice(1, 3).map(l => l.trim());
  ok(primeras[0] === "const log = document.getElementById('debug-log');" && primeras[1] === 'log.hidden = false;', `el clic lo muestra antes que nada (${JSON.stringify(primeras)})`);
  ok((fuente.match(/getElementById\('debug-log'\)/g) || []).length === 1, 'nadie más escribe en #debug-log');
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
