// Loader de los tests de la tanda 110 (v=353): `ficha-cancion-historial-caido`, `historial-caido-vistas`
// e `import-historial-caido`.
//
// Deja REALES los módulos de `src/js/` cuya ruta termina en alguno de `data.reales` (los pasa el test con
// `register(…, { data: { reales } })`) y DOBLA todos los demás. El doble se arma acá mismo, leyendo los nombres
// que exporta el módulo real: cada nombre exportado es una función que, al llamarla, busca en
// `globalThis.__T110.stubs['<ruta corta>:<nombre>']` o `stubs['<nombre>']` y, si no hay, devuelve `undefined`.
// Si `globalThis.__T110.valores` trae el nombre (con o sin la ruta), el export es ese VALOR (para constantes).
// La ruta corta es la que va después de `/js/` (`api.js`, `ui/components.js`…).
//
// Compara por el FINAL de la ruta, así sirve igual para `src/` y para la copia de `src/` de 27a0e64d.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARCA = '?t110doble';
let REALES = [];
export function initialize(data) { REALES = (data && data.reales) || []; }

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.startsWith('file:') && /\/src\/js\//.test(r.url) && !r.url.endsWith(MARCA)
      && !REALES.some((x) => r.url.endsWith(x))) {
    return { ...r, url: r.url + MARCA, shortCircuit: true };
  }
  return r;
}

function nombresExportados(fuente) {
  const sin = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const n = new Set();
  for (const m of sin.matchAll(/^export\s+(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)) n.add(m[1]);
  for (const m of sin.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) n.add(m[1]);
  for (const m of sin.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const p = parte.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      n.add(as[as.length - 1].trim());
    }
  }
  return [...n];
}

export async function load(url, context, next) {
  if (!url.endsWith(MARCA)) return next(url, context);
  const real = url.slice(0, -MARCA.length);
  const ruta = fileURLToPath(real);
  const corta = ruta.split('/src/js/').pop();
  const nombres = nombresExportados(readFileSync(ruta, 'utf8'));
  const cuerpo = nombres.map((n) => `export const ${n} = __d(${JSON.stringify(n)});`).join('\n');
  const source = `const __m = ${JSON.stringify(corta)};
const __d = (n) => {
  const S = (globalThis.__T110 ||= { stubs: {}, valores: {} });
  const k = __m + ':' + n;
  if (S.valores && k in S.valores) return S.valores[k];
  if (S.valores && n in S.valores) return S.valores[n];
  return (...a) => { const f = S.stubs[k] || S.stubs[n]; return f ? f(...a) : undefined; };
};
${cuerpo}
`;
  return { format: 'module', shortCircuit: true, source };
}
