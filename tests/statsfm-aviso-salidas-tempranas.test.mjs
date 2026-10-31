// El aviso de stats.fm no debe salir encima de las tarjetas donde la vista NO sigue (sin me gusta, candado, «No pude cargar»).
// Las vistas reales en Node con dobles inventados (tests/dobles/*-t104.mjs); cero red y cero almacenamiento real.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const valores = new Map();
globalThis.localStorage = {
  getItem: k => valores.get(k) ?? null,
  setItem: (k, v) => valores.set(k, String(v)),
  removeItem: k => valores.delete(k),
};
globalThis.__T104 = { usuario: true, falla: null, llamadas: 0, sinLikes: false, sinHistorial: false, dueno: true };
globalThis.window = {};
const avisos = [];
console.warn = (...args) => avisos.push(args.map(v => v instanceof Error ? v.message : String(v)).join(' '));

let contenido;
globalThis.document = {
  getElementById: id => id.endsWith('-content') ? contenido : null,
  querySelector: () => null,
  addEventListener: () => {},
};
function contenedor() {
  contenido = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  return contenido;
}

register('./dobles/loader-t104.mjs', pathToFileURL(import.meta.filename));
const vistas = [
  ['zeroplays', await import('../src/js/features/zero-plays.js'), 'zeroplays_use_statsfm', 'No pude cargar el historial.'],
  ['skips', await import('../src/js/features/skips.js'), 'skips_use_statsfm', 'No pude cargar el historial de skips.'],
];
const AVISO = /No se pudieron leer tus datos de stats\.fm/;
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}`);
  if (cond) pasaron++; else fallaron++;
}
// stats.fm siempre falla, con el toggle encendido y el usuario configurado.
async function pintar(mod, clave, estado) {
  valores.clear();
  valores.set(clave, '1');
  Object.assign(globalThis.__T104, { usuario: true, falla: 'doble: Stats.fm 503', llamadas: 0, sinLikes: false, sinHistorial: false, dueno: true }, estado);
  avisos.length = 0;
  await mod.render(contenedor());
  return { html: contenido.innerHTML, avisos: [...avisos], llamadas: globalThis.__T104.llamadas };
}

for (const [nombre, mod, clave, textoNoCargo] of vistas) {
  const warnCrudo = a => a.includes(`[${nombre}]`) && a.includes('Stats.fm 503');

  console.log(`\n[${nombre}] a) sin me gusta`);
  const a = await pintar(mod, clave, { sinLikes: true });
  ok(a.llamadas === 1, `a) se intentó leer stats.fm (el fallo es real)`);
  ok(/SIN-LIKES-INVENTADO/.test(a.html), 'a) sale la tarjeta de sin me gusta');
  ok(!AVISO.test(a.html), 'a) NO sale el aviso de stats.fm');
  ok(a.avisos.some(warnCrudo), 'd) a) el console.warn con prefijo y error crudo sigue');

  console.log(`[${nombre}] b) con me gusta, sin historial, no dueño`);
  const b = await pintar(mod, clave, { sinHistorial: true, dueno: false });
  ok(/BLOQUEO-INVENTADO/.test(b.html), 'b) sale la tarjeta de bloqueo');
  ok(!AVISO.test(b.html), 'b) NO sale el aviso de stats.fm');
  ok(b.avisos.some(warnCrudo), 'd) b) el console.warn con prefijo y error crudo sigue');

  console.log(`[${nombre}] c) con me gusta, sin historial, dueño`);
  const c = await pintar(mod, clave, { sinHistorial: true, dueno: true });
  ok(c.html.includes(textoNoCargo), 'c) sale «No pude cargar el historial…»');
  ok(!AVISO.test(c.html), 'c) NO sale el aviso de stats.fm');
  ok(c.avisos.some(warnCrudo), 'd) c) el console.warn con prefijo y error crudo sigue');

  console.log(`[${nombre}] e) CONSERVACIÓN: con me gusta y con historial`);
  const e = await pintar(mod, clave, {});
  ok(AVISO.test(e.html), 'e) el aviso SÍ sale con la lista de resultados');
  ok(/la vista sigue sin ellos/.test(e.html), 'e) el aviso explica que la vista sigue');
  ok(/color:\s*var\(--color-text-secondary\)/.test(e.html), 'e) el aviso conserva su estilo');
  ok(e.avisos.some(warnCrudo), 'e) el console.warn con prefijo y error crudo sigue');
}
console.log(`\n${pasaron} asserts OK · ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
