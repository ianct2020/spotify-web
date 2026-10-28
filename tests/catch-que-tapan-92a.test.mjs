// Las vistas reales deben avisar si falla Stats.fm y conservar el HTML cuando carga bien.
// Datos y errores SEMBRADOS; cero red y cero almacenamiento real.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const valores = new Map();
globalThis.localStorage = {
  getItem: k => valores.get(k) ?? null,
  setItem: (k, v) => valores.set(k, String(v)),
  removeItem: k => valores.delete(k),
};
globalThis.__T92A = { usuario: true, falla: null, llamadas: 0 };
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

register('./dobles/loader-catch-t92a.mjs', pathToFileURL(import.meta.filename));
const vistas = [
  ['zeroplays', await import('../src/js/features/zero-plays.js'), 'zeroplays_use_statsfm', '68c8556aa4c34c5e0c51fb0eb21f2fcd84398816c22351a76c9fc84ec177f3e2'],
  ['skips', await import('../src/js/features/skips.js'), 'skips_use_statsfm', '121ea6ecf001dd2821ea023605b51130580ff1d97ec6142d01a7a6eb927f8e22'],
];
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}`);
  if (cond) pasaron++; else fallaron++;
}
async function pintar(mod, clave, { usuario = true, falla = null, activo = true } = {}) {
  valores.clear();
  valores.set(clave, activo ? '1' : '0');
  Object.assign(globalThis.__T92A, { usuario, falla, llamadas: 0 });
  avisos.length = 0;
  const nodo = contenedor();
  await mod.render(nodo);
  return { html: contenido.innerHTML, avisos: [...avisos], llamadas: globalThis.__T92A.llamadas };
}

for (const [nombre, mod, clave, hashBase] of vistas) {
  console.log(`\n[${nombre}] Stats.fm falla con el cruce activado`);
  const roto = await pintar(mod, clave, { falla: 'doble: Stats.fm 503' });
  ok(roto.llamadas === 1, 'se intentó leer Stats.fm una sola vez');
  ok(roto.avisos.some(a => a.includes(`[${nombre}]`) && a.includes('Stats.fm 503')), 'console.warn tiene prefijo y error crudo');
  ok(/No se pudieron leer tus datos de stats\.fm/.test(roto.html), 'la vista muestra el aviso de Stats.fm');
  ok(/la vista sigue sin ellos/.test(roto.html), 'el aviso explica que el resto sigue');
  ok(/color:\s*var\(--color-text-secondary\)/.test(roto.html), 'el aviso tiene estilo en el HTML');

  console.log(`[${nombre}] CONSERVACIÓN: carga normal`);
  const bien = await pintar(mod, clave);
  ok(createHash('sha256').update(bien.html).digest('hex') === hashBase, 'HTML normal idéntico al de origin/main');
  ok(bien.llamadas === 1 && bien.avisos.length === 0, 'una lectura y ningún warning');
  ok(!/No se pudieron leer tus datos de stats\.fm/.test(bien.html), 'sin aviso en el HTML normal');
  const apagado = await pintar(mod, clave, { activo: false });
  ok(apagado.llamadas === 0 && !/No se pudieron leer tus datos de stats\.fm/.test(apagado.html), 'toggle apagado: ningún cambio ni petición');
  const sinUsuario = await pintar(mod, clave, { usuario: false });
  ok(sinUsuario.llamadas === 0 && !/No se pudieron leer tus datos de stats\.fm/.test(sinUsuario.html), 'sin cuenta configurada: ningún aviso');
}
console.log(`\n${pasaron} asserts OK · ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
