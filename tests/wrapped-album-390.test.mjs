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
