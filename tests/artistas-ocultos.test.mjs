// Ocultar un artista: UNA pieza para las cinco vistas (v=276; la quinta, #new-releases, v=278).
//
// POR QUÉ ESTA SUITE EXISTE
//
// El encargo del 06/10 pide explícitamente «que las tres usen LA MISMA función
// (contá las definiciones)». Contarlas a mano una vez no sirve de nada: lo que
// hace falta es que el día que alguien escriba la suya al lado, salte. Es el
// mismo fallo silencioso que `tests/icons.test.mjs` vigila para los glifos —
// una segunda copia no rompe nada, solo hace que las vistas dejen de
// comportarse igual, y nadie lo nota hasta probar dos seguidas.
//
// Y la otra mitad: que el almacén siga siendo el de siempre. Ian tenía 12
// artistas ocultos en `recs_ocultos` el 06/10. Si alguien le cambia el `lsKey`
// o el `playlistName` a la pieza compartida, esos 12 no se borran —quedan en
// localStorage y en la playlist— pero la app deja de poder alcanzarlos: la
// vista pregunta por una clave que nadie escribió. Un oculto inalcanzable es
// un oculto perdido, y pasa sin una sola excepción en consola.
//
// Corre sin navegador y sin token.
// Correr con: node tests/artistas-ocultos.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => readFileSync(join(raiz, rel), 'utf8');

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}

function archivosJs(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) archivosJs(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const fuentes = archivosJs(join(raiz, 'src/js'));
const PIEZA = 'src/js/features/artistas-ocultos.js';
const pieza = leer(PIEZA);

// Las cinco vistas que comparten la pieza.
const VISTAS = {
  '#similar': 'src/js/features/similar-artists.js',
  '#discover-artists': 'src/js/features/discover-artists.js',
  '#follow-artists': 'src/js/features/follow-artists.js',
  '#recs': 'src/js/features/recommendations.js',
  '#new-releases': 'src/js/features/new-releases.js',   // v=278
};

// ── 1. LAS DEFINICIONES SE CUENTAN ─────────────────────────────────────────
//
// Esto es el assert que el encargo pide por su nombre. Se cuenta sobre todo
// `src/js`, no sobre una lista escrita a mano: una copia nueva en un archivo
// nuevo cae acá sin que nadie toque este test.
for (const nombre of ['alternarArtistaOculto', 'claveDeArtista', 'artistaEstaOculto', 'conectarMenuArtista', 'botonMenuArtistaHtml']) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${nombre}\\b|(?:export\\s+)?const\\s+${nombre}\\s*=`, 'g');
  const donde = fuentes
    .map(p => [p.slice(raiz.length + 1), (readFileSync(p, 'utf8').match(re) || []).length])
    .filter(([, n]) => n > 0);
  const total = donde.reduce((s, [, n]) => s + n, 0);
  comprobar(`de \`${nombre}\` hay EXACTAMENTE una definición en src/js`,
    total === 1 && donde.length === 1 && donde[0][0] === PIEZA,
    `definiciones: ${total} — en ${donde.map(([f, n]) => `${f} (${n})`).join(', ') || '(ninguna)'}`);
}

// Y el almacén: uno, en la pieza. Si aparece un séptimo `createHiddenStore` con
// clave de artista, es el séptimo almacén que la decisión del 06/10 descartó
// midiendo el costo — que vuelva, pero no por descuido.
// Se cuentan las LLAMADAS, no la definición: `util/hidden-sync.js` es quien
// exporta `createHiddenStore`, así que se excluye — si no, el seis da siete y el
// assert mentiría en los dos sentidos.
const conCreate = fuentes
  .filter(p => !p.endsWith(join('util', 'hidden-sync.js')))
  .filter(p => /createHiddenStore\s*\(/.test(readFileSync(p, 'utf8')))
  .map(p => p.slice(raiz.length + 1));
comprobar('hay SEIS almacenes de ocultos y ni uno más',
  conCreate.length === 6, `los crean: ${conCreate.join(', ')}`);
comprobar('el almacén de ARTISTAS lo crea solo la pieza compartida',
  conCreate.includes(PIEZA)
  && !/createHiddenStore\s*\(/.test(leer(VISTAS['#recs'])),
  `recommendations.js ya no crea el suyo`);

// ── 2. el almacén es EL DE SIEMPRE ─────────────────────────────────────────
// Byte a byte contra lo que `recommendations.js` tenía en v=275, que es lo que
// escribieron los 12 ocultos de Ian. Ver el aviso de la cabecera.
comprobar("el lsKey sigue siendo 'recs_ocultos'", pieza.includes("lsKey: 'recs_ocultos'"),
  'si cambia, los ocultos que ya existen quedan inalcanzables');
comprobar("la playlist sigue siendo «fonoteca · ocultos (recomendados)»",
  pieza.includes("playlistName: 'fonoteca · ocultos (recomendados)'"));
comprobar("el label sigue siendo 'recomendados' (es el que sale en los avisos)",
  pieza.includes("label: 'recomendados'"));
comprobar('la clave sigue siendo el nombre en minúsculas y SIN normalizar',
  /claveDeArtista[\s\S]{0,200}nombre\.toLowerCase\(\)/.test(pieza)
  && !/claveDeArtista[\s\S]{0,200}normalize\(/.test(pieza),
  'normalizarla acá orfanaría los 12 ocultos del 06/10');

// ── 3. las tres vistas nuevas usan la pieza, y no su propia versión ────────
for (const [vista, ruta] of Object.entries(VISTAS)) {
  const src = leer(ruta);
  comprobar(`${vista} importa la pieza compartida`,
    /from '\.\/artistas-ocultos\.js'/.test(src), ruta);
  comprobar(`${vista} llama a \`alternarArtistaOculto\``,
    src.includes('alternarArtistaOculto('), ruta);
  // El atajo que delata una copia: tocar el store a mano con la clave cruda.
  comprobar(`${vista} no se arma la clave a mano`,
    !/\.toLowerCase\(\)\s*\)\s*;?\s*$/m.test('') && !/artistasOcultos\.toggle\(/.test(src),
    `${ruta}: la clave y el toggle son de la pieza, no de la vista`);
}

// ── 4. el control es un BOTÓN VISIBLE, no el click derecho ─────────────────
//
// Ian propuso reemplazar el menú contextual (04/10) y la decisión fue no
// hacerlo: el click derecho del navegador trae copiar, abrir en pestaña nueva e
// inspeccionar, y un gesto que no se ve no se descubre solo. El click derecho
// quedó como propina. Lo que este assert impide es que mañana alguien saque el
// botón y deje solo el atajo — la vista seguiría «teniendo la función» y el
// control sería invisible.
comprobar('la pieza pinta un botón ⋮ visible',
  /botonMenuArtistaHtml[\s\S]{0,400}art-oc-menu-btn/.test(pieza)
  && pieza.includes('iconoPuntosVertical('));
// El patrón «solo en hover» es una regla de DESCENDENCIA (`.fila:hover
// .art-oc-menu-btn { … }`) o un botón que nace invisible. Las dos cosas harían
// que el control no se descubra solo, que es justo lo que el botón viene a
// arreglar. Un `.art-oc-menu-btn:hover` propio NO es eso: es el realce normal.
const cssBtn = leer('src/css/components.css');
comprobar('el botón no se pinta SOLO en hover',
  !/:hover\s+\.art-oc-menu-btn\s*\{/.test(cssBtn),
  'una regla `algo:hover .art-oc-menu-btn` esconde el control hasta pasar el ratón');
comprobar('el botón no nace invisible',
  !/\.art-oc-menu-btn\s*\{[^}]*(display:\s*none|opacity:\s*0\s*[;}])/.test(cssBtn));
comprobar('el click derecho es opcional (`selectorFila`), no el único acceso',
  /selectorFila\s*=\s*null/.test(pieza) && pieza.includes("addEventListener('contextmenu'"));
for (const [vista, ruta] of Object.entries(VISTAS)) {
  if (vista === '#recs') continue;   // #recs ya tenía su ojo desde v=205
  comprobar(`${vista} pinta el botón ⋮`,
    leer(ruta).includes('botonMenuArtistaHtml('), ruta);
}

// ── 4b. #new-releases (v=278): el control en SU línea, no en la barra ──────
//
// La barra de #new-releases quedó con 69 px libres el 05/10 y el botón mide 143
// (159 con tres cifras). Dentro de `.disco-controls` la rompería a dos filas, y
// eso lo prueba el banco `ocultar-artista-novedades`; acá se vigila lo que se
// puede leer sin navegador: que el marcado no vuelva a meterlo en la barra.
const nr = leer(VISTAS['#new-releases']);
const barraNr = nr.slice(nr.indexOf('<div class="disco-controls'), nr.indexOf('${avisoFrescuraHtml('));
comprobar('#new-releases: el botón «Artistas ocultos» NO está en `.disco-controls`',
  barraNr.length > 200 && !barraNr.includes('botonArtistasOcultosHtml') && !barraNr.includes('newrel-mode-artistas'),
  'el marcado de la barra nombra el botón de artistas ocultos');
comprobar('#new-releases: el botón va en `.disco-linea-artistas`, la línea propia',
  /disco-linea-artistas[\s\S]{0,40}\$\{b\}|botonArtistasOcultosHtml\('newrel-mode-artistas'[\s\S]{0,300}disco-linea-artistas/.test(nr));
comprobar('#new-releases: reusa `artistaEstaOculto` para podar (no una clave a mano)',
  nr.includes('artistaEstaOculto(a.name)') && !/recs_ocultos/.test(nr));
// La tarjeta es de dos vistas: solo le hace sitio al botón, no lo define.
const comun = leer('src/js/features/discover-common.js');
comprobar('renderAlbumCard recibe el ⋮ de la vista (`menuArtistaHtml`) y no lo construye',
  comun.includes('menuArtistaHtml') && !comun.includes('botonMenuArtistaHtml'));

// ── 5. los SVG viven en ui/icons.js, no en la pieza ────────────────────────
// El 04/10 el menú lateral tenía su propia copia de los SVG y ya había
// divergido. La pieza compartida no puede repetir eso.
comprobar('la pieza no escribe ningún <svg> a mano',
  !pieza.includes('<svg'), 'los iconos salen de ui/icons.js');

// ── 6. solo variables de tema, nunca colores a mano ────────────────────────
const css = leer('src/css/components.css');
const bloqueMenu = css.slice(css.indexOf('.art-oc-menu-btn'), css.indexOf('.art-oc-menu-item:hover'));
const colorACasco = bloqueMenu.match(/:\s*(#[0-9a-fA-F]{3,8}|rgb\()/g) || [];
comprobar('el menú no tiene colores a mano (solo var(--…))',
  colorACasco.length === 0, `encontrados: ${colorACasco.join(', ')}`);

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
