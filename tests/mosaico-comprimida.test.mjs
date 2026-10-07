// Suite «la descarga comprimida del mosaico» (M.3, v=281).
//
// Qué decide esta tanda, y qué protege cada assert:
//
// 1. **Son DOS descargas, no una con perilla.** La de siempre sigue en
//    `CALIDAD_JPEG` (0,92) y baja el original; la nueva usa
//    `CALIDAD_JPEG_COMPRIMIDA` (0,85) y existe para que entre en los 15 MB de
//    WhatsApp. Si alguien «unifica» las dos calidades, la de arriba deja de ser
//    el original y nadie se entera: el archivo sale igual y con el mismo nombre.
// 2. **Nombres de archivo distintos.** Las dos descargas del MISMO mosaico
//    tienen que convivir en la carpeta de descargas. Con el mismo nombre,
//    Chrome le cuelga un «(1)» a la segunda y ya no se sabe cuál es cuál.
// 3. **No se baja la calidad sola hasta que entre.** El peso de un mosaico lo
//    manda la rejilla, no la calidad (medido: de 0,92 a 0,85 el PSNR cae 1,3 dB
//    y el archivo, un 33 %; de 0,85 para abajo se pierde nitidez visible y se
//    ahorra poco). Un bucle que baje la calidad hasta entrar en 15 MB elige por
//    el tamaño, que es justo lo que el encargo del 07/10 prohíbe. Si no entra,
//    se DICE.
//
// Lo que NO puede probar: el pixel ni el peso. Una vista no se monta en Node y
// `toBlob` no existe fuera del navegador. Los pesos y el aspecto están medidos
// el 07/10 contra las 5.715 portadas reales, con capturas al 100 % y lupa 4× en
// `~/Escritorio/2026-10-07 comprimir y censar el mosaico/`.
//
// Correr con: node tests/mosaico-comprimida.test.mjs

import { readFileSync } from 'node:fs';

const vista = readFileSync(new URL('../src/js/features/mosaico.js', import.meta.url), 'utf8');

let ok_ = 0, mal = 0;
const ok = (cond, msg) => { if (cond) { ok_++; console.log('  ✓', msg); } else { mal++; console.log('  ✗', msg); } };

console.log('A. dos calidades declaradas, cada una con su sitio');
ok(/const CALIDAD_JPEG = 0\.92;/.test(vista),
  'la de siempre sigue en 0,92: la descarga de arriba y la galería no cambian');
ok(/const CALIDAD_JPEG_COMPRIMIDA = 0\.85;/.test(vista),
  'y la de compartir es 0,85, elegida mirando (ver el comentario de la constante)');
ok(CALIDAD_JPEG_COMPRIMIDA_valor() < CALIDAD_JPEG_valor(),
  'la comprimida comprime más que la normal, que es lo único que la justifica');
ok(/const TOPE_COMPARTIR = 15e6;/.test(vista),
  'el tope de WhatsApp vive en una constante y no suelto en un texto');

function CALIDAD_JPEG_valor() { return Number(/const CALIDAD_JPEG = ([\d.]+);/.exec(vista)[1]); }
function CALIDAD_JPEG_COMPRIMIDA_valor() { return Number(/const CALIDAD_JPEG_COMPRIMIDA = ([\d.]+);/.exec(vista)[1]); }

console.log('\nB. la descarga de siempre NO se tocó');
const usosNormal = (vista.match(/toBlob\(r?e?s?, 'image\/jpeg', CALIDAD_JPEG\)/g) || []).length;
ok(usosNormal >= 2,
  `la calidad normal sigue usada en los dos sitios de siempre (descarga y galería): ${usosNormal}`);
ok(/\$\('mos-descargar'\)\.addEventListener/.test(vista),
  'el botón «Descargar» sigue existiendo con su propio handler');

console.log('\nC. la segunda descarga existe, y es otra');
ok(/id="mos-descargar-chica"/.test(vista), 'hay un segundo botón en la barra de la salida');
ok(/\$\('mos-descargar-chica'\)\.addEventListener/.test(vista), 'con su propio handler');
ok(/toBlob\(res, 'image\/jpeg', CALIDAD_JPEG_COMPRIMIDA\)/.test(vista),
  'que comprime con la calidad comprimida y no con la normal');
ok((vista.match(/CALIDAD_JPEG_COMPRIMIDA/g) || []).length >= 3,
  'y la constante se usa, no solo se declara (nombre de archivo + toBlob + comentario)');

console.log('\nD. nombres de archivo distintos');
ok(/function nombreDescarga\(f, \{ comprimida = false \} = \{\}\)/.test(vista),
  'nombreDescarga toma un `comprimida` opt-in, así que el nombre de siempre no cambia por defecto');
ok(/const cola = comprimida \? `-comprimida/.test(vista),
  'y le mete un sufijo propio al nombre');
ok(/nombreDescarga\(\{ \.\.\.ultimo, nombreImagen \}, \{ comprimida: true \}\)/.test(vista),
  'la descarga comprimida pide el nombre comprimido');
// Con dientes: el nombre normal NO puede llevar el sufijo.
const cuerpoNombre = /function nombreDescarga[\s\S]*?\n  \}/.exec(vista)[0];
ok(/comprimida \?/.test(cuerpoNombre) && /: ''/.test(cuerpoNombre),
  'y sin el flag el sufijo es la cadena vacía: el archivo de siempre se sigue llamando igual');

console.log('\nE. no se elige por el tamaño');
const handler = /\$\('mos-descargar-chica'\)\.addEventListener[\s\S]*?\n  \}\);/.exec(vista)[0];
ok(!/while|for \(|\.reduce\(|CALIDADES/.test(handler),
  'el handler no tiene bucle: una sola pasada a una sola calidad, no una escalera que baje hasta entrar');
ok(/blob\.size <= TOPE_COMPARTIR/.test(handler),
  'mide si entra en los 15 MB…');
ok(/Se pasa de los/.test(handler) && /'warning'/.test(handler),
  '…y si no entra lo dice con un toast de aviso, en vez de callarse o recomprimir');
ok(/lo que sobra es resolución, no calidad/.test(handler),
  'y le dice a Ian por dónde va la salida (la resolución), que es la conclusión medida del 07/10');

console.log(`\n${ok_} asserts OK${mal ? `, ${mal} FALLOS` : ''}`);
process.exit(mal ? 1 : 0);
