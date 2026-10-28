// Recomendaciones: un error de likes no puede disfrazarse de biblioteca vacía.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

globalThis.__T92B_RECS = { likes: [], likesError: null, likesCalls: 0, similaresCalls: 0 };
const avisos = [];
console.warn = (...a) => avisos.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' '));
const elementos = new Map();
const elemento = id => {
  if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', style: {}, textContent: '', onclick: null, querySelectorAll: () => [] });
  return elementos.get(id);
};
globalThis.document = { getElementById: elemento, querySelectorAll: () => [], addEventListener: () => {} };
register('./dobles/loader-catch-92b-recs.mjs', pathToFileURL(import.meta.filename));
const recs = await import('../src/js/features/recommendations.js');
let bien = 0, mal = 0;
function ok(cond, nombre) { console.log(`  ${cond ? '✓' : '✗'} ${nombre}`); cond ? bien++ : mal++; }
function preparar(error) {
  elementos.clear(); avisos.length = 0;
  Object.assign(globalThis.__T92B_RECS, { likes: [], likesError: error, likesCalls: 0, similaresCalls: 0 });
  recs.render(elemento('contenedor'));
}
async function correr() { await elemento('recs-run-btn').onclick(); }
const hash = x => createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex');

console.log('[1a] Fallo de likes INVENTADO');
preparar('doble: likes no disponibles');
await correr();
ok(globalThis.__T92B_RECS.likesCalls === 1, 'intentó leer los likes una vez');
ok(globalThis.__T92B_RECS.similaresCalls === 0, 'no calculó con biblioteca vacía');
ok(/No se han podido leer tus me gusta/.test(elemento('recs-panel').innerHTML), 'la pantalla informa qué falló');
ok(avisos.some(x => x.includes('[recs]') && x.includes('doble: likes no disponibles')), 'console.warn conserva el error crudo');

console.log('[1b] Conservación con likes leídos, lista vacía válida');
preparar(null);
await correr();
ok(globalThis.__T92B_RECS.similaresCalls === 1, 'sí calcula cuando los likes se leyeron');
ok(avisos.length === 0, 'sin avisos falsos');
ok(/No hay recomendaciones nuevas/.test(elemento('recs-panel').innerHTML), 'mantiene el resultado normal');
ok(hash(elemento('recs-panel').innerHTML) === '5be420144280bae725f9604c63086f574a1c5711d4ce207b4c7f52d9bde7d028', 'HTML normalizado idéntico a origin/main');
console.log('  HTML conservado sha256:', hash(elemento('recs-panel').innerHTML));
console.log(`${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
