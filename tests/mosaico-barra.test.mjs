// Suite «la barra del mosaico» (v=265): el botón apretado se ve, los cuatro ajustes son
// grupos, el deslizador y el selector de archivo son propios, y «Variada» es el defecto.
//
// Hasta v=264 `.is-on` no tenía NINGUNA regla sobre `.btn-secondary`: el JS marcaba el
// botón y la hoja no lo pintaba, así que mirando la pantalla no se sabía qué rejilla ni
// qué variedad estaban puestas. Una vista no se puede montar en Node, así que esto lee
// el fuente de la vista y la hoja. Lo que sí se midió en el DOM real (copia del perfil,
// clics reales, capturas en Violeta/Ámbar/Papel/Aguamarina) está en
// `fonoteca-migracion/RESUMEN-MOSAICO-PROLIJO-2026-10-01.md`; este test solo impide que
// las decisiones se deshagan sin que nadie lo note.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };

const css = readFileSync(new URL('../src/css/main.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const js = readFileSync(new URL('../src/js/features/mosaico.js', import.meta.url), 'utf8');

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

// ── guarda del guarda ─────────────────────────────────────────────────────────
const on = regla('.mos-seg button.is-on');
const off = regla('.mos-seg button');
const grupo = regla('.mos-grupo');
const rango = regla('.mos-rango');
const pista = regla('.mos-rango::-webkit-slider-runnable-track');
const pulgar = regla('.mos-rango::-webkit-slider-thumb');
for (const [nombre, c] of [['.mos-seg button.is-on', on], ['.mos-seg button', off], ['.mos-grupo', grupo], ['.mos-rango', rango],
  ['la pista del deslizador', pista], ['el pulgar del deslizador', pulgar]]) ok(c, `existe la regla de ${nombre}`);

// ── A. el seleccionado se distingue ───────────────────────────────────────────
ok(prop(on, 'background') === 'var(--color-accent-tint)', `el seleccionado lleva fondo --color-accent-tint — dice «${prop(on, 'background')}»`);
ok(/var\(--color-accent\)/.test(prop(on, 'box-shadow') || ''), 'y un aro del acento (no depende solo del tono del fondo)');
ok(prop(on, 'color') === 'var(--color-text)', 'y el texto pleno');
ok(prop(off, 'color') === 'var(--color-text-secondary)', 'contra el texto atenuado de los que no están elegidos');
ok(Number(prop(on, 'font-weight')) > Number(prop(off, 'font-weight')), 'y más peso: tres señales, no una');

// «Ningún color a mano»: el violeta clavado en 26 sitios es deuda anotada y esta barra no suma otro.
const bloque = [...css.matchAll(/(?:^|[}\s])(\.mos-[^{]*)\{([^}]*)\}/g)];
ok(bloque.length >= 15, `se encontraron las reglas .mos-* (${bloque.length})`);
for (const [, sel, cuerpo] of bloque) {
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(cuerpo), `${sel.trim()}: ningún color escrito a mano`);
}

// ── B. cuatro ajustes, cuatro grupos ──────────────────────────────────────────
ok((js.match(/<section class="mos-grupo"/g) || []).length === 4, 'el marcado tiene cuatro grupos .mos-grupo');
ok((js.match(/class="mos-grupo-t"/g) || []).length === 4, 'cada uno con su rótulo');
ok(/role="group"/.test(js), 'y los botones agrupados con role="group"');
ok(/container-type:\s*inline-size/.test(css), 'las columnas se reparten por el ancho de la barra, no del viewport');
ok(/@container\s*\(min-width:\s*1180px\)\s*\{\s*\.mos-ajustes\s*\{[^}]*repeat\(4,/.test(css), 'a partir de 1180 px, cuatro columnas a todo el ancho');
ok(/@container\s*\(min-width:\s*560px\)\s*\{\s*\.mos-ajustes\s*\{[^}]*repeat\(2,/.test(css), 'entre 560 y 1179, dos');
ok(!/class="btn btn-secondary[^"]*"[^>]*data-(grilla|variedad|modo)/.test(js), 'los botones de opción ya no son .btn-secondary sueltos');
ok(/aria-pressed/.test(js) && /setAttribute\('aria-pressed'/.test(js), 'aria-pressed en el marcado y al cambiar');

// ── C. deslizador y selector propios ──────────────────────────────────────────
ok(/type="range" id="mos-tinte" class="mos-rango"/.test(js), 'el deslizador usa la clase propia');
ok(/style\.setProperty\('--p'/.test(js), 'el tramo recorrido se actualiza en cada input');
ok(/<output class="mos-valor" id="mos-tinte-val"/.test(js), 'el valor se ve (output)');
ok(/0 % · sin tinte/.test(js) && /100 % · color de tu imagen/.test(js), 'y los dos extremos del recorrido, rotulados');
ok(/type="file" id="mos-file" accept="image\/\*" hidden/.test(js), 'el <input type=file> nativo va escondido');
ok(/id="mos-elegir"/.test(js) && /\$\('mos-elegir'\)\.addEventListener\('click', \(\) => \$\('mos-file'\)\.click\(\)\)/.test(js),
  'y un botón propio le hace click()');
ok(/lugar\.textContent = file\.name;/.test(js), 'el nombre se enseña entero');
ok(/overflow-wrap:\s*anywhere/.test(regla('.mos-archivo')), 'y puede partirse en dos líneas, nunca recortarse');
ok(!/text-overflow/.test(regla('.mos-archivo')), 'sin elipsis');

// ── D. el defecto ─────────────────────────────────────────────────────────────
const def = js.match(/const VARIEDAD_DEFECTO = (\d+);/);
ok(def && Number(def[1]) === 6, `la variedad por defecto es «Variada» (6) — dice ${def && def[1]}`);
ok(/\{ n: 6, etiqueta: 'Variada'/.test(js), 'y 6 es «Variada»');
const grilla = js.match(/const GRILLA_DEFECTO = (\d+);/);
ok(grilla && Number(grilla[1]) === 80, 'la rejilla por defecto sigue siendo Normal · 80');

console.log(`mosaico-barra: ${n} asserts OK`);
