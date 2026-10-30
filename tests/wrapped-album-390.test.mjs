// Puerta estática del álbum del año: el banco postal está ocupado por otra rama.
// La medida real de la tarjeta se toma aparte con Chrome temporal y datos INVENTADOS.
import { readFileSync } from 'node:fs';

const css = readFileSync(process.env.CSS_PATH || 'src/css/main.css', 'utf8');
const reglaMovil = css.indexOf('.wrapped-album-hero { padding: 14px;');
const inicio = css.lastIndexOf('@media (max-width: 600px) {', reglaMovil);
const fin = css.indexOf('@media', inicio + 1);
const movil = css.slice(inicio, fin);
const hero = movil.match(/\.wrapped-album-hero\s*\{([^}]*)\}/)?.[1] || '';
const nombre = movil.match(/\.wrapped-album-hero-name\s*\{([^}]*)\}/)?.[1] || '';
const comprobar = (condicion, mensaje) => {
  console.log(`  ${condicion ? '✓' : '✗'} ${mensaje}`);
  if (!condicion) process.exitCode = 1;
};

comprobar(/flex-direction:\s*column\s*;/.test(hero), 'el álbum apila los hijos en móvil');
comprobar(/width:\s*100%\s*;/.test(nombre) && /min-width:\s*0\s*;/.test(nombre), 'el nombre usa el ancho de la tarjeta');
comprobar(/-webkit-line-clamp:\s*3\s*;/.test(nombre) && /overflow:\s*hidden\s*;/.test(nombre), 'el nombre ocupa como máximo tres renglones');
comprobar(/overflow-wrap:\s*anywhere\s*;/.test(nombre), 'un nombre de una sola palabra también entra');

// ── El nombre entero en el `title` (v=344, tanda 97) ────────────────────────
//
// Recortado a tres renglones, el nombre largo no se lee entero: al apoyar el dedo o el ratón, el `title` lo
// dice. Se pinta el renglón del nombre del «Álbum del año» tal como está en `features/wrapped.js` (el
// literal, evaluado con el `escapeHtml` de la app sobre un `document` mínimo que escapa como el navegador)
// con un nombre INVENTADO de más de 120 caracteres, con comillas y un «<», y se lee lo que queda.
{
  const js = readFileSync(process.env.WRAPPED_PATH || 'src/js/features/wrapped.js', 'utf8');
  const bloque = js.slice(js.indexOf('<div class="wrapped-tile-label">Álbum del año</div>'));
  const renglon = bloque.match(/<div class="wrapped-album-hero-name"[^\n]*<\/div>/)?.[0] || '';
  comprobar(renglon, 'wrapped.js pinta el nombre del «Álbum del año» en .wrapped-album-hero-name');
  // El `escapeHtml` de la app hace textContent → innerHTML; este `document` serializa como el navegador.
  // Lo demás es el andamio mínimo para que `components.js` cargue en Node (el de `postal-anio.test.mjs`).
  globalThis.document = {
    createElement: () => { let t = ''; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;'); } }; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    body: {}, querySelector: () => null, getElementById: () => null,
  };
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  globalThis.window = globalThis;
  let escapeHtml = null;
  try { ({ escapeHtml } = await import('../src/js/ui/components.js')); } catch (e) { console.log(`    (components.js no carga: ${e.message})`); }
  comprobar(typeof escapeHtml === 'function', 'el escapeHtml de la app carga en Node');
  const LARGO = 'Un Disco Inventado Con "Comillas", <Signos> & Un Nombre Tan Largo Que A 390 px No Entra En Tres Renglones Ni Queriendo, Volumen Dos';
  comprobar(LARGO.length > 120, `el nombre inventado tiene más de 120 caracteres (${LARGO.length})`);
  let html = '';
  try { html = escapeHtml && renglon ? new Function('escapeHtml', 'topAlbum', `return \`${renglon}\`;`)(escapeHtml, { name: LARGO }) : ''; } catch (e) { html = ''; comprobar(false, `el renglón no se pudo pintar: ${e.message}`); }
  const desescapar = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const m = html.match(/^<div class="wrapped-album-hero-name"((?:\s+[a-z-]+="[^"]*")*)>([^<]*)<\/div>$/);
  const title = m?.[1].match(/\stitle="([^"]*)"/)?.[1];
  comprobar(m && desescapar(m[2]) === LARGO, 'el texto del nombre es el nombre entero, escapado');
  comprobar(title != null && desescapar(title) === LARGO, `lleva title con el nombre entero (${title == null ? 'sin title' : desescapar(title).length + ' caracteres'})`);
  comprobar(title != null && title === m?.[2], 'y el title va escapado igual que el texto (ninguna comilla corta el atributo)');

  // ── El gemelo: el «Álbum de siempre» del Wrapped de siempre (v=345, tanda 98) ──────────────
  // El mismo renglón, el mismo nombre INVENTADO, la misma lectura. Hasta v=344 este no llevaba `title`.
  const bloqueSiempre = js.slice(js.indexOf('<div class="wrapped-tile-label">Álbum de siempre</div>'));
  const renglonSiempre = js.includes('<div class="wrapped-tile-label">Álbum de siempre</div>') ? (bloqueSiempre.match(/<div class="wrapped-album-hero-name"[^\n]*<\/div>/)?.[0] || '') : '';
  comprobar(renglonSiempre, 'wrapped.js pinta el nombre del «Álbum de siempre» en .wrapped-album-hero-name');
  let htmlSiempre = '';
  try { htmlSiempre = escapeHtml && renglonSiempre ? new Function('escapeHtml', 'topAlbum', `return \`${renglonSiempre}\`;`)(escapeHtml, { name: LARGO }) : ''; } catch (e) { htmlSiempre = ''; comprobar(false, `el renglón del «Álbum de siempre» no se pudo pintar: ${e.message}`); }
  const ms = htmlSiempre.match(/^<div class="wrapped-album-hero-name"((?:\s+[a-z-]+="[^"]*")*)>([^<]*)<\/div>$/);
  const titleSiempre = ms?.[1].match(/\stitle="([^"]*)"/)?.[1];
  comprobar(ms && desescapar(ms[2]) === LARGO, 'el «Álbum de siempre»: el texto del nombre es el nombre entero, escapado');
  comprobar(titleSiempre != null && desescapar(titleSiempre) === LARGO, `el «Álbum de siempre» lleva title con el nombre entero (${titleSiempre == null ? 'sin title' : desescapar(titleSiempre).length + ' caracteres'})`);
  comprobar(titleSiempre != null && titleSiempre === ms?.[2], 'y su title va escapado igual que el texto');
}
