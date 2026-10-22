// ── El espía del banco `guard-ruta-vieja` (v=329, tanda 75) ──────────────────
//
// Hasta v=328 el banco sabía que `#records` (la ruta vieja) había terminado porque TIRABA: esperaba
// el `console.warn('[crash-guard] la ruta vieja falló…')` de `guardRoute()`. Desde v=329 la vista
// pregunta por la vigencia después de su `await` y ya no tira, así que ese aviso no llega nunca y el
// banco no tenía con qué saber que terminó.
//
// El caso (`guard-ruta-vieja-caso.html`) pone un import map que desvía `/js/features/records.js` y
// `/js/features/by-artist.js` a este archivo, con `?m=<módulo>`. Este archivo importa el módulo REAL
// (el scope `/banco/` del import map lo deja pasar sin desviar) y envuelve SOLO su `render`: anota en
// `window.__renders` cuándo terminó y si tiró (con el mensaje), y re-tira el MISMO error, así que a
// `guardRoute()` le llega lo de siempre. `app.js` es el único que importa los dos módulos, y solo su
// `render`. `src/` no se toca.

const m = new URL(import.meta.url).searchParams.get('m');
const real = await import(`/js/features/${m}.js`);

export async function render(container) {
  const r = { ruta: m, fin: false, tiro: null };
  (window.__renders ||= []).push(r);
  try {
    return await real.render(container);
  } catch (e) {
    r.tiro = String(e?.message || e);
    throw e;
  } finally {
    r.fin = true;
  }
}
