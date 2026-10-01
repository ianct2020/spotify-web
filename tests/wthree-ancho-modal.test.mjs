// Suite «W-Three a lo ancho» (v=264): el reparto del modal por álbum y el subtítulo
// de las tarjetas.
//
// Hasta v=263 el modal partía el ancho en dos `1fr`: la mitad (437 px) iba al panel
// «Orden dentro del álbum», una lista de COMO MUCHO tres ítems y casi siempre vacía,
// mientras el nombre de la pista se cortaba a 74 px (6 de 21 pistas en «4SZNZ»,
// 4 de 7 en «BLING BØI EP 2»). Y el subtítulo de la tarjeta (artista · tiempo ·
// plays) iba en `--color-text-muted` a 2,27:1 de contraste, y a 1,60:1 en las filas
// `is-weak` (que le sumaban `opacity: 0.6`).
//
// Un modal no se puede montar en Node, así que esto lee la HOJA. Lo que sí se midió
// en el DOM real (copia del perfil, clics reales) está en
// `fonoteca-migracion/RESUMEN-WTHREE-A-LO-ANCHO-2026-09-30.md`; este test solo
// impide que las dos decisiones se deshagan sin que nadie lo note, con una guarda
// del guarda por si alguien renombra una clase y la búsqueda deja de encontrar nada.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };

const css = readFileSync(new URL('../src/css/main.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// El cuerpo de la regla cuyo selector es EXACTAMENTE `selector` (primera aparición,
// o la `indice`-ésima). Devuelve null si no existe: eso lo cubre la guarda del guarda.
function regla(selector, indice = 0) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g');
  let m, i = 0;
  while ((m = re.exec(css))) { if (i++ === indice) return m[1]; }
  return null;
}
const prop = (cuerpo, nombre) => {
  const m = cuerpo && cuerpo.match(new RegExp(`(?:^|[;\\s])${nombre}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

// ── guarda del guarda: las reglas que se vigilan existen ──────────────────────
const body = regla('.wt-body');
const modal = regla('.wt-modal');
const subt = regla('.wthree-album-artist');
const weak = regla('.wthree-album-artist.is-weak');
const ordenNombre = regla('.wt-col-right .wthree-order-name');
ok(body, 'existe la regla .wt-body');
ok(modal, 'existe la regla .wt-modal');
ok(subt, 'existe la regla .wthree-album-artist');
ok(weak, 'existe la regla .wthree-album-artist.is-weak');
ok(ordenNombre, 'existe la regla .wt-col-right .wthree-order-name');

// ── A. reparto del ancho ──────────────────────────────────────────────────────
const cols = prop(body, 'grid-template-columns');
ok(cols, '.wt-body declara grid-template-columns');
const m = cols.match(/^minmax\(0,\s*1fr\)\s+(\d+)px$/);
ok(m, `.wt-body: pistas flexibles + panel de orden de ancho FIJO (no dos 1fr) — dice «${cols}»`);
const ordenPx = Number(m[1]);
ok(ordenPx >= 240 && ordenPx <= 320,
  `el panel de orden mide entre 240 y 320 px (con 240 el corte se mudaba al orden: 2 de 3 nombres con «…») — dice ${ordenPx}`);

const ancho = prop(modal, 'width');
const mw = ancho && ancho.match(/^min\((\d+)px,\s*94vw\)$/);
ok(mw, `.wt-modal: width min(N px, 94vw), el 94vw sigue mandando en pantallas chicas — dice «${ancho}»`);
const anchoPx = Number(mw[1]);
ok(anchoPx >= 1000, `el modal se ensanchó (antes 920) — dice ${anchoPx}`);
ok(anchoPx <= 1284, `y entra en 1366 px de viewport sin scroll horizontal (94vw = 1284) — dice ${anchoPx}`);
ok(Number(prop(modal, 'max-width').replace('px', '')) === anchoPx, 'max-width y width dicen lo mismo');
ok(/overflow:\s*hidden/.test(modal) && /flex-direction:\s*column/.test(modal),
  'el modal sigue con cabecera y pie fijos (flex column + overflow hidden): no se inventó otra regla');
ok(!/modal-picker|picker-scroll/.test(modal), '.wt-modal no mezcla la regla de los modales genéricos');

// Debajo de 900 px el body se apila en una columna, como antes.
ok(/@media\s*\(max-width:\s*899px\)\s*\{\s*\.wt-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/.test(css),
  'en <900 px el .wt-body vuelve a una sola columna');

// Los nombres del panel de orden pueden partirse en dos renglones (solo dentro del modal).
ok(/-webkit-line-clamp:\s*2/.test(ordenNombre), 'los nombres del orden se parten en dos renglones antes del «…»');
ok(/white-space:\s*normal/.test(ordenNombre), 'y no van en una línea');
const ordenBase = regla('.wthree-order-name');
ok(ordenBase && /white-space:\s*nowrap/.test(ordenBase), 'la regla base de .wthree-order-name queda como estaba');

// ── B. el subtítulo de las tarjetas ───────────────────────────────────────────
ok(prop(subt, 'color') === 'var(--color-text-secondary)',
  `el subtítulo usa --color-text-secondary (2,27:1 → 4,77:1 en Violeta) — dice «${prop(subt, 'color')}»`);
ok(prop(weak, 'color') === 'var(--color-text-secondary)', 'las filas is-weak también');
ok(prop(weak, 'opacity') === null, 'y SIN opacity: con 0,6 encima ningún color de la paleta pasa de 2,6:1 (7,5 px de letra)');
ok(prop(subt, 'opacity') === null, 'la regla base tampoco lleva opacity');
for (const [nombre, cuerpo] of [['.wthree-album-artist', subt], ['.wthree-album-artist.is-weak', weak]]) {
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(cuerpo), `${nombre}: ningún color escrito a mano (hay 26 sitios con el violeta clavado y no se suma otro)`);
}
ok(!/--color-text-muted/.test(subt + weak), 'ya no usa --color-text-muted');

// v=265: el tamaño. 7,5 px pasaba el contraste y seguía siendo ilegible.
const fs = Number((prop(subt, 'font-size') || '').replace('px', ''));
ok(fs >= 10, `el subtítulo se lee: 10 px o más (v=215 lo dejó en 7,5 para que entraran cinco columnas) — dice ${fs}`);
const rejilla = regla('.wthree-album-list');
ok(rejilla && /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(rejilla),
  'las columnas de tarjetas siguen siendo cinco, a mano: no salen del tamaño de la letra (subirlo no las quita)');

console.log(`wthree-ancho-modal: ${n} asserts OK`);
